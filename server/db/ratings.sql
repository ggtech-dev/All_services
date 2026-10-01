-- Ratings after delivery, and phone notifications (web push). Re-runnable. Runs after subscriptions.sql.

-- ============ ratings ============
-- The customer rates the agent 1–5 ⭐ with an optional comment, once per delivered order (can change it for 7 days).
CREATE TABLE IF NOT EXISTS order_ratings (
  order_id    INT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    INT REFERENCES users(id) ON DELETE SET NULL,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     VARCHAR(500),
  tags        TEXT[] NOT NULL DEFAULT '{}',   -- quick picks: "On time", "Polite", "Late", "Wrong items"…
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_ratings_agent_idx ON order_ratings(agent_id, created_at DESC);

CREATE OR REPLACE PROCEDURE sp_rate_order(p_customer_id INT, p_order_id INT, p_stars INT, p_comment TEXT, p_tags TEXT[])
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  o orders;
  r order_ratings;
  v_tags TEXT[];
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id AND customer_id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'delivered' OR o.agent_id IS NULL THEN
    RAISE EXCEPTION 'You can rate after the order is delivered' USING ERRCODE = '55000';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Choose 1 to 5 stars' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM order_ratings WHERE order_id = p_order_id;
  IF FOUND AND r.created_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Ratings can be changed for 7 days only' USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(array_agg(DISTINCT left(trim(t), 30)) FILTER (WHERE trim(t) <> ''), '{}') INTO v_tags
    FROM unnest(coalesce(p_tags, '{}')) t;
  IF cardinality(v_tags) > 8 THEN
    RAISE EXCEPTION 'Too many tags' USING ERRCODE = '22023';
  END IF;
  INSERT INTO order_ratings (order_id, customer_id, agent_id, stars, comment, tags)
  VALUES (p_order_id, p_customer_id, o.agent_id, p_stars,
          nullif(left(trim(regexp_replace(coalesce(p_comment, ''), '\s+', ' ', 'g')), 500), ''), v_tags)
  ON CONFLICT (order_id) DO UPDATE
    SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, tags = EXCLUDED.tags, updated_at = now();
END $$;

-- Average and count per agent (all time and last 30 days) + the share of 1–2 ⭐ ratings.
CREATE OR REPLACE FUNCTION fn_agent_rating(p_agent_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'avg', round(avg(stars), 1), 'count', count(*),
    'avg_30d', round(avg(stars) FILTER (WHERE created_at >= now() - interval '30 days'), 1),
    'low', count(*) FILTER (WHERE stars <= 2),
    'stars', jsonb_build_array(count(*) FILTER (WHERE stars = 5), count(*) FILTER (WHERE stars = 4), count(*) FILTER (WHERE stars = 3),
                               count(*) FILTER (WHERE stars = 2), count(*) FILTER (WHERE stars = 1)))
    FROM order_ratings WHERE agent_id = p_agent_id
$$;

-- Admin: agents to watch — low average (below 3.5 with at least 3 ratings) or a 1–2 ⭐ rating in the last 7 days.
CREATE OR REPLACE FUNCTION fn_rating_watchlist() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.avg, x.recent_low DESC), '[]'::jsonb) FROM (
    SELECT r.agent_id, u.full_name AS agent_name, u.phone AS agent_phone,
           round(avg(r.stars), 1) AS avg, count(*) AS count,
           count(*) FILTER (WHERE r.stars <= 2 AND r.created_at >= now() - interval '7 days') AS recent_low
      FROM order_ratings r JOIN users u ON u.id = r.agent_id
     GROUP BY r.agent_id, u.full_name, u.phone
    HAVING (avg(r.stars) < 3.5 AND count(*) >= 3)
        OR count(*) FILTER (WHERE r.stars <= 2 AND r.created_at >= now() - interval '7 days') > 0
  ) x
$$;

-- ============ phone notifications (web push) ============
-- One row per device/browser that allowed notifications. Keys are from the browser's PushSubscription.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

-- Server-only secrets (the web push private key). Never sent to browsers — unlike site_settings.
CREATE TABLE IF NOT EXISTS app_secrets (
  key   VARCHAR(60) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Agents to alert about a new order: active, online, right type of work, and allowed (subscriptions).
CREATE OR REPLACE FUNCTION fn_agents_to_alert(p_order_id INT) RETURNS SETOF INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT a.user_id FROM agents a JOIN orders o ON o.id = p_order_id
   WHERE a.status = 'active' AND a.is_online AND o.skill_code = ANY (a.skills) AND fn_agent_may_take(a.user_id, o.id)
$$;
