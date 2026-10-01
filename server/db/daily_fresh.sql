-- Daily fresh services (vegetables, meat & fish, milk). Re-runnable. Runs before delivery.sql.
--  * price as per shop bill: items have no fixed price; the agent buys at the market and uploads the bill
--  * sold by weight: kg in 250 g steps, litres in 500 ml steps (also bunches / pieces / packs)
--  * delivery time window per service (e.g. 6–10 AM), offered as 1-hour slots for today and tomorrow
--  * the customer's cutting instructions per item (curry cut, boneless, cleaned…)
--  * services highlighted on the home page

ALTER TABLE services ADD COLUMN IF NOT EXISTS price_on_bill BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS window_from   SMALLINT;   -- hour of the day, India time
ALTER TABLE services ADD COLUMN IF NOT EXISTS window_to     SMALLINT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_featured   BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products ADD COLUMN IF NOT EXISTS sell_by      VARCHAR(10) NOT NULL DEFAULT 'pack';
ALTER TABLE products ADD COLUMN IF NOT EXISTS note_options TEXT[];      -- e.g. {Curry cut, Boneless}

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sell_by VARCHAR(10) NOT NULL DEFAULT 'pack';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS on_bill BOOLEAN NOT NULL DEFAULT false;  -- priced by the shop bill
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note    VARCHAR(200);                    -- cutting instructions

DO $$
BEGIN
  -- quantities can be 1.5 kg now
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'order_items' AND column_name = 'qty') = 'integer' THEN
    ALTER TABLE order_items ALTER COLUMN qty TYPE NUMERIC(8,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'services'::regclass AND conname = 'services_window_chk') THEN
    ALTER TABLE services ADD CONSTRAINT services_window_chk CHECK (
      (window_from IS NULL AND window_to IS NULL)
      OR (window_from BETWEEN 0 AND 23 AND window_to BETWEEN 1 AND 24 AND window_to > window_from));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'products'::regclass AND conname = 'products_sell_by_chk') THEN
    ALTER TABLE products ADD CONSTRAINT products_sell_by_chk CHECK (sell_by IN ('pack', 'kg', 'litre', 'bunch', 'piece'));
  END IF;
END $$;

-- ============ quantities ============

-- kg: 250 g steps up to 20 kg · litre: 500 ml steps up to 20 L · pack / bunch / piece: 1 to 50.
CREATE OR REPLACE FUNCTION fn_qty_ok(p_sell_by TEXT, p_qty NUMERIC) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT p_qty IS NOT NULL AND CASE p_sell_by
    WHEN 'kg'    THEN p_qty BETWEEN 0.25 AND 20 AND p_qty * 4 = trunc(p_qty * 4)
    WHEN 'litre' THEN p_qty BETWEEN 0.5 AND 20 AND p_qty * 2 = trunc(p_qty * 2)
    ELSE p_qty BETWEEN 1 AND 50 AND p_qty = trunc(p_qty)
  END
$$;

-- "250 g", "1.5 kg", "500 ml", "2 L", "3 bunches", "2 pcs", "x2"
CREATE OR REPLACE FUNCTION fn_qty_label(p_qty NUMERIC, p_sell_by TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT CASE coalesce(p_sell_by, 'pack')
    WHEN 'kg'    THEN CASE WHEN p_qty < 1 THEN round(p_qty * 1000)::int || ' g' ELSE trim_scale(p_qty) || ' kg' END
    WHEN 'litre' THEN CASE WHEN p_qty < 1 THEN round(p_qty * 1000)::int || ' ml' ELSE trim_scale(p_qty) || ' L' END
    WHEN 'bunch' THEN trim_scale(p_qty) || CASE WHEN p_qty = 1 THEN ' bunch' ELSE ' bunches' END
    WHEN 'piece' THEN trim_scale(p_qty) || CASE WHEN p_qty = 1 THEN ' pc' ELSE ' pcs' END
    ELSE 'x' || trim_scale(p_qty)
  END
$$;

-- One item in a list: "Tomato 1.5 kg", "Vijaya Milk x2", "Sona Masoori Rice" (one pack),
-- "Sugar — 2 kg" (a line of the customer's own list: p_unit holds what they wrote).
DROP FUNCTION IF EXISTS fn_item_label(TEXT, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION fn_item_label(p_name TEXT, p_qty NUMERIC, p_sell_by TEXT, p_unit TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT p_name || CASE WHEN p_sell_by = 'custom' THEN coalesce(' — ' || p_unit, '')
                        WHEN coalesce(p_sell_by, 'pack') = 'pack' AND p_qty = 1 THEN ''
                        ELSE ' ' || fn_qty_label(p_qty, p_sell_by) END
$$;

-- ============ delivery time windows ============

-- 6 → "6 AM", 12 → "12 PM", 18 → "6 PM", 24 → "12 AM"
CREATE OR REPLACE FUNCTION fn_hour_label(p_hour INT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT CASE WHEN p_hour % 24 = 0 THEN '12 AM' WHEN p_hour = 12 THEN '12 PM'
              WHEN p_hour < 12 THEN p_hour || ' AM' ELSE (p_hour - 12) || ' PM' END
$$;

-- One-hour slots inside a window for today and tomorrow (India time), e.g. "Thu 1 Oct, 6 AM – 7 AM".
-- A slot can be chosen until 45 minutes before it ends.
CREATE OR REPLACE FUNCTION fn_delivery_slots(p_from INT, p_to INT) RETURNS TEXT[]
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(array_agg(to_char(d, 'Dy FMDD Mon') || ', ' || fn_hour_label(h) || ' – ' || fn_hour_label(h + 1) ORDER BY d, h), ARRAY[]::TEXT[])
    FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp,
                         (now() AT TIME ZONE 'Asia/Kolkata')::date::timestamp + interval '1 day', interval '1 day') AS g(d),
         generate_series(p_from, p_to - 1) AS h
   WHERE d + make_interval(hours => h + 1) - interval '45 minutes' > now() AT TIME ZONE 'Asia/Kolkata'
$$;

-- Delivery window for a set of services in one trip: the overlap of their windows.
-- conflict = the windows don't overlap (e.g. 6–9 AM milk with 5–8 PM items): order them separately.
CREATE OR REPLACE FUNCTION fn_window_of(p_service_ids INT[], OUT win_from INT, OUT win_to INT, OUT conflict BOOLEAN)
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT max(s.window_from)::int, min(s.window_to)::int, coalesce(max(s.window_from) >= min(s.window_to), false)
    FROM services s
   WHERE s.window_from IS NOT NULL AND s.id = ANY(coalesce(p_service_ids, ARRAY[]::INT[]))
$$;

-- Delivery window for a cart (its products' services) or a booking.
CREATE OR REPLACE FUNCTION fn_cart_window(p_product_ids INT[], p_service_id INT,
                                          OUT win_from INT, OUT win_to INT, OUT conflict BOOLEAN)
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT * FROM fn_window_of(ARRAY(SELECT service_id FROM products WHERE id = ANY(coalesce(p_product_ids, ARRAY[]::INT[])))
                             || coalesce(p_service_id, 0))
$$;

-- ============ admin: service & product options ============

-- p_allows_list: customers may also write their own list / send a photo (kirana…); NULL = leave as it is.
DROP PROCEDURE IF EXISTS sp_set_service_options(INT, BOOLEAN, INT, INT, BOOLEAN);
CREATE OR REPLACE PROCEDURE sp_set_service_options(p_service_id INT, p_price_on_bill BOOLEAN,
                                                   p_window_from INT, p_window_to INT, p_is_featured BOOLEAN,
                                                   p_allows_list BOOLEAN DEFAULT NULL)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF (p_window_from IS NULL) <> (p_window_to IS NULL) THEN
    RAISE EXCEPTION 'Choose both the start and the end of the delivery time' USING ERRCODE = '22023';
  END IF;
  IF p_window_from IS NOT NULL AND NOT (p_window_from BETWEEN 0 AND 23 AND p_window_to BETWEEN 1 AND 24 AND p_window_to > p_window_from) THEN
    RAISE EXCEPTION 'Delivery time: the end must be after the start' USING ERRCODE = '22023';
  END IF;
  UPDATE services
     SET price_on_bill = coalesce(p_price_on_bill, price_on_bill),
         window_from   = p_window_from,
         window_to     = p_window_to,
         is_featured   = coalesce(p_is_featured, is_featured),
         allows_list   = coalesce(p_allows_list, allows_list)
   WHERE id = p_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- p_note_options: the quick choices customers tap (curry cut, boneless…); empty = no cutting instructions.
CREATE OR REPLACE PROCEDURE sp_set_product_selling(p_product_id INT, p_sell_by TEXT, p_note_options TEXT[])
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_opts TEXT[];
BEGIN
  IF p_sell_by IS NULL OR p_sell_by NOT IN ('pack', 'kg', 'litre', 'bunch', 'piece') THEN
    RAISE EXCEPTION 'Choose how it is sold: pack, kg, litre, bunch or piece' USING ERRCODE = '22023';
  END IF;
  -- trimmed, blanks and repeats dropped, kept in the admin's order
  SELECT array_agg(opt ORDER BY pos) INTO v_opts
    FROM (SELECT left(trim(o), 40) AS opt, min(i) AS pos
            FROM unnest(p_note_options) WITH ORDINALITY AS u(o, i)
           WHERE trim(o) <> '' GROUP BY 1) x;
  IF cardinality(v_opts) > 12 THEN
    RAISE EXCEPTION 'Up to 12 cutting options' USING ERRCODE = '22023';
  END IF;
  UPDATE products SET sell_by = p_sell_by, note_options = v_opts WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
END $$;
