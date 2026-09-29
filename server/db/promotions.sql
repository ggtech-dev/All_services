-- Promotions / advertisements shown on the customer home page, managed from Admin → Promotions. Re-runnable.

CREATE TABLE IF NOT EXISTS promotions (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL,              -- internal name for the admin, e.g. "Diwali milk offer"
  title        VARCHAR(90),                        -- optional text shown to customers
  subtitle     VARCHAR(200),
  image_url    TEXT,
  image_credit TEXT,
  cta_text     VARCHAR(30),                        -- button, e.g. "Order now"
  link_type    VARCHAR(12)  NOT NULL DEFAULT 'none' CHECK (link_type IN ('none', 'category', 'service', 'url')),
  link_value   TEXT,                               -- category slug, service slug or https:// URL
  placement    VARCHAR(12)  NOT NULL DEFAULT 'carousel' CHECK (placement IN ('carousel', 'tile')),
  bg_color     VARCHAR(7)   NOT NULL DEFAULT '#4f46e5',
  text_color   VARCHAR(7)   NOT NULL DEFAULT '#ffffff',
  starts_at    TIMESTAMPTZ,                        -- NULL = immediately
  ends_at      TIMESTAMPTZ,                        -- NULL = no end
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  sort_order   INT          NOT NULL DEFAULT 0,
  views        BIGINT       NOT NULL DEFAULT 0,
  clicks       BIGINT       NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS promotions_live_idx ON promotions (placement, sort_order) WHERE is_active;

CREATE OR REPLACE TRIGGER promotions_touch BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
-- Admin changes appear in the Activity log (view/click counters are excluded below).
CREATE OR REPLACE TRIGGER promotions_audit AFTER INSERT OR DELETE ON promotions FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER promotions_audit_update AFTER UPDATE ON promotions FOR EACH ROW
  WHEN (OLD.views IS NOT DISTINCT FROM NEW.views AND OLD.clicks IS NOT DISTINCT FROM NEW.clicks)
  EXECUTE FUNCTION trg_audit();

-- Live / Scheduled / Expired / Off, for the admin list.
CREATE OR REPLACE FUNCTION fn_promotion_state(p promotions) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN NOT p.is_active THEN 'off'
    WHEN p.starts_at IS NOT NULL AND p.starts_at > now() THEN 'scheduled'
    WHEN p.ends_at IS NOT NULL AND p.ends_at <= now() THEN 'expired'
    ELSE 'live'
  END
$$;

-- Creates (p_id NULL) or updates a promotion.
CREATE OR REPLACE FUNCTION fn_save_promotion(
  p_id INT, p_name TEXT, p_title TEXT, p_subtitle TEXT, p_image_url TEXT, p_image_credit TEXT,
  p_cta_text TEXT, p_link_type TEXT, p_link_value TEXT, p_placement TEXT, p_bg_color TEXT, p_text_color TEXT,
  p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ, p_is_active BOOLEAN
) RETURNS promotions
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v promotions;
  v_link TEXT := nullif(trim(coalesce(p_link_value, '')), '');
  v_type TEXT := coalesce(nullif(p_link_type, ''), 'none');
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Give the promotion a name (only you see it)' USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(coalesce(p_image_url, '')), '') IS NULL AND nullif(trim(coalesce(p_title, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add an image or a title — otherwise the promotion would be empty' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_bg_color, '#000000') !~ '^#[0-9a-fA-F]{6}$' OR coalesce(p_text_color, '#ffffff') !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Colours must look like #1a2b3c' USING ERRCODE = '22023';
  END IF;
  IF p_ends_at IS NOT NULL AND p_starts_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'The end date must be after the start date' USING ERRCODE = '22023';
  END IF;

  -- The link must point at something that exists.
  IF v_type = 'none' THEN
    v_link := NULL;
  ELSIF v_link IS NULL THEN
    RAISE EXCEPTION 'Choose where the promotion should link to' USING ERRCODE = '22023';
  ELSIF v_type = 'category' AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = v_link) THEN
    RAISE EXCEPTION 'That category does not exist' USING ERRCODE = '22023';
  ELSIF v_type = 'service' AND NOT EXISTS (SELECT 1 FROM services WHERE slug = v_link) THEN
    RAISE EXCEPTION 'That service does not exist' USING ERRCODE = '22023';
  ELSIF v_type = 'url' AND v_link !~* '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'Links must start with https://' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO promotions (name, title, subtitle, image_url, image_credit, cta_text, link_type, link_value, placement,
                            bg_color, text_color, starts_at, ends_at, is_active, sort_order)
    VALUES (trim(p_name), nullif(trim(p_title), ''), nullif(trim(p_subtitle), ''), nullif(trim(p_image_url), ''),
            nullif(trim(p_image_credit), ''), nullif(trim(p_cta_text), ''), v_type, v_link, coalesce(p_placement, 'carousel'),
            coalesce(p_bg_color, '#4f46e5'), coalesce(p_text_color, '#ffffff'), p_starts_at, p_ends_at, coalesce(p_is_active, true),
            (SELECT coalesce(max(sort_order) + 1, 0) FROM promotions WHERE placement = coalesce(p_placement, 'carousel')))
    RETURNING * INTO v;
  ELSE
    UPDATE promotions
       SET name = trim(p_name), title = nullif(trim(p_title), ''), subtitle = nullif(trim(p_subtitle), ''),
           image_url = nullif(trim(p_image_url), ''), image_credit = nullif(trim(p_image_credit), ''),
           cta_text = nullif(trim(p_cta_text), ''), link_type = v_type, link_value = v_link,
           placement = coalesce(p_placement, placement), bg_color = coalesce(p_bg_color, bg_color),
           text_color = coalesce(p_text_color, text_color), starts_at = p_starts_at, ends_at = p_ends_at,
           is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id
    RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Promotion not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE PROCEDURE sp_set_promotion_active(p_id INT, p_active BOOLEAN)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE promotions SET is_active = p_active WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE PROCEDURE sp_delete_promotion(p_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  DELETE FROM promotions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Moves a promotion one place earlier (-1) or later (+1) within its placement, by swapping with its neighbour.
CREATE OR REPLACE PROCEDURE sp_move_promotion(p_id INT, p_direction INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  me promotions;
  other promotions;
BEGIN
  SELECT * INTO me FROM promotions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion not found' USING ERRCODE = 'P0002';
  END IF;
  -- Make positions distinct first, so swapping always works.
  UPDATE promotions p SET sort_order = x.rn
    FROM (SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rn FROM promotions WHERE placement = me.placement) x
   WHERE p.id = x.id AND p.sort_order IS DISTINCT FROM x.rn;
  SELECT * INTO me FROM promotions WHERE id = p_id;
  SELECT * INTO other FROM promotions
   WHERE placement = me.placement
     AND CASE WHEN p_direction < 0 THEN sort_order < me.sort_order ELSE sort_order > me.sort_order END
   ORDER BY CASE WHEN p_direction < 0 THEN -sort_order ELSE sort_order END
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN; -- already first / last
  END IF;
  UPDATE promotions SET sort_order = other.sort_order WHERE id = me.id;
  UPDATE promotions SET sort_order = me.sort_order WHERE id = other.id;
END $$;

-- Counts views (the promotion was shown) and clicks, for the admin's statistics.
CREATE OR REPLACE PROCEDURE sp_promotion_views(p_ids INT[])
LANGUAGE sql SET search_path FROM CURRENT AS $$
  UPDATE promotions SET views = views + 1 WHERE id = ANY (p_ids[1:20]);
$$;

CREATE OR REPLACE PROCEDURE sp_promotion_click(p_id INT)
LANGUAGE sql SET search_path FROM CURRENT AS $$
  UPDATE promotions SET clicks = clicks + 1 WHERE id = p_id;
$$;
