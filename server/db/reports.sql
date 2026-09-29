-- Admin reports. Days and hours are counted in India time (IST). Re-runnable.

-- Headline numbers for [p_from, p_to] (dates inclusive, IST).
CREATE OR REPLACE FUNCTION fn_report_kpis(p_from DATE, p_to DATE) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH o AS (
    SELECT * FROM orders
     WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'orders',          (SELECT count(*) FROM o),
    'delivered',       (SELECT count(*) FROM o WHERE status = 'delivered'),
    'cancelled',       (SELECT count(*) FROM o WHERE status = 'cancelled'),
    'in_progress',     (SELECT count(*) FROM o WHERE status IN ('placed', 'assigned', 'picked_up')),
    'revenue',         (SELECT coalesce(sum(total), 0) FROM o WHERE status = 'delivered'),
    'delivery_fees',   (SELECT coalesce(sum(delivery_fee), 0) FROM o WHERE status = 'delivered'),
    'agent_pay',       (SELECT coalesce(sum(agent_earning), 0) FROM o WHERE status = 'delivered'),
    'avg_order_value', (SELECT round(avg(total)) FROM o WHERE status = 'delivered'),
    'avg_minutes',     (SELECT round(avg(extract(epoch FROM delivered_at - created_at) / 60)) FROM o WHERE status = 'delivered'),
    'customers',       (SELECT count(DISTINCT customer_id) FROM o),
    'new_customers',   (SELECT count(*) FROM users WHERE role = 'customer'
                          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to),
    'active_agents',   (SELECT count(DISTINCT agent_id) FROM o WHERE status = 'delivered')
  )
$$;

-- Everything the Reports page shows, in one call.
CREATE OR REPLACE FUNCTION fn_report(p_from DATE, p_to DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_days INT := p_to - p_from + 1;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Choose a valid date range' USING ERRCODE = '22023';
  END IF;
  IF v_days > 366 THEN
    RAISE EXCEPTION 'Please choose at most one year' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH o AS (
      SELECT o.*, (o.created_at AT TIME ZONE 'Asia/Kolkata') AS local_at
        FROM orders o
       WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    )
    SELECT jsonb_build_object(
      'from', p_from, 'to', p_to, 'days', v_days,
      'kpis', fn_report_kpis(p_from, p_to),
      -- same length period just before, for "▲ 12% vs previous" comparisons
      'previous', fn_report_kpis(p_from - v_days, p_from - 1),

      'by_day', (
        SELECT jsonb_agg(jsonb_build_object('day', d::date, 'orders', coalesce(x.orders, 0),
                 'delivered', coalesce(x.delivered, 0), 'cancelled', coalesce(x.cancelled, 0), 'revenue', coalesce(x.revenue, 0)) ORDER BY d)
          FROM generate_series(p_from, p_to, interval '1 day') d
          LEFT JOIN (
            SELECT local_at::date AS day, count(*) AS orders,
                   count(*) FILTER (WHERE status = 'delivered') AS delivered,
                   count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                   sum(total) FILTER (WHERE status = 'delivered') AS revenue
              FROM o GROUP BY 1
          ) x ON x.day = d::date
      ),

      'by_hour', (
        SELECT jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(x.n, 0)) ORDER BY h)
          FROM generate_series(0, 23) h
          LEFT JOIN (SELECT extract(hour FROM local_at)::int AS hour, count(*) AS n FROM o GROUP BY 1) x ON x.hour = h
      ),

      'by_type', coalesce((
        SELECT jsonb_agg(r ORDER BY r.orders DESC) FROM (
          SELECT t.name, t.icon, count(*) AS orders,
                 count(*) FILTER (WHERE o.status = 'delivered') AS delivered,
                 coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS revenue
            FROM o JOIN service_types t ON t.code = o.skill_code
           GROUP BY t.code, t.name, t.icon
        ) r), '[]'),

      'by_category', coalesce((
        SELECT jsonb_agg(r ORDER BY r.orders DESC) FROM (
          SELECT c.name, c.icon, count(DISTINCT o.id) AS orders,
                 coalesce(sum(i.line_total) FILTER (WHERE o.status = 'delivered'), 0) AS revenue
            FROM o
            JOIN order_items i ON i.order_id = o.id
            LEFT JOIN products p ON p.id = i.product_id
            JOIN services s ON s.id = coalesce(i.service_id, p.service_id)
            JOIN categories c ON c.id = s.category_id
           GROUP BY c.id, c.name, c.icon
        ) r), '[]'),

      'by_area', coalesce((
        SELECT jsonb_agg(r ORDER BY r.orders DESC) FROM (
          SELECT l.name, count(*) AS orders,
                 count(*) FILTER (WHERE o.status = 'delivered') AS delivered,
                 coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS revenue
            FROM o JOIN localities l ON l.id = o.locality_id
           GROUP BY l.id, l.name
           ORDER BY count(*) DESC LIMIT 15
        ) r), '[]'),

      'top_items', coalesce((
        SELECT jsonb_agg(r ORDER BY r.qty DESC) FROM (
          SELECT i.name, max(i.unit) AS unit, sum(i.qty) AS qty, sum(i.line_total) AS revenue, count(DISTINCT o.id) AS orders
            FROM o JOIN order_items i ON i.order_id = o.id
           WHERE o.status <> 'cancelled'
           GROUP BY i.name
           ORDER BY sum(i.qty) DESC LIMIT 15
        ) r), '[]'),

      'agents', coalesce((
        SELECT jsonb_agg(r ORDER BY r.delivered DESC, r.name) FROM (
          SELECT v.user_id, v.full_name AS name, v.phone, v.skills, v.state,
                 count(o.id) FILTER (WHERE o.agent_id = v.user_id) AS handled,
                 count(o.id) FILTER (WHERE o.status = 'delivered') AS delivered,
                 count(o.id) FILTER (WHERE o.status IN ('assigned', 'picked_up')) AS in_progress,
                 round(avg(extract(epoch FROM o.delivered_at - o.assigned_at) / 60) FILTER (WHERE o.status = 'delivered')) AS avg_minutes,
                 coalesce(sum(o.agent_earning) FILTER (WHERE o.status = 'delivered'), 0) AS earnings,
                 coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS order_value,
                 (SELECT count(*) FROM order_events e JOIN o o2 ON o2.id = e.order_id
                   WHERE e.actor_id = v.user_id AND e.note LIKE 'Released by agent%') AS released,
                 (fn_agent_stats(v.user_id)->>'cash_in_hand')::numeric AS cash_in_hand
            FROM v_agents v
            LEFT JOIN o ON o.agent_id = v.user_id
           WHERE v.status IN ('active', 'suspended')
           GROUP BY v.user_id, v.full_name, v.phone, v.skills, v.state
        ) r), '[]'),

      'top_customers', coalesce((
        SELECT jsonb_agg(r ORDER BY r.spent DESC, r.orders DESC) FROM (
          SELECT u.id, coalesce(u.full_name, u.username) AS name, u.phone, count(*) AS orders,
                 count(*) FILTER (WHERE o.status = 'delivered') AS delivered,
                 coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS spent
            FROM o JOIN users u ON u.id = o.customer_id
           GROUP BY u.id
           ORDER BY coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) DESC, count(*) DESC
           LIMIT 10
        ) r), '[]'),

      'cancel_reasons', coalesce((
        SELECT jsonb_agg(r ORDER BY r.n DESC) FROM (
          SELECT coalesce(cancel_reason, 'No reason') AS reason, count(*) AS n
            FROM o WHERE status = 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 8
        ) r), '[]')
    )
  );
END $$;
