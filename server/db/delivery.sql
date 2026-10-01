-- Delivery charges, the company UPI QR, and service areas. Re-runnable.
-- Each service has its own delivery charge, set by the admin (a mixed cart pays the highest one: one trip).
-- The customer pays the delivery charge to the company's UPI QR at the door; the agent confirms
-- "Received on company UPI" (or "paid cash") before the order can be marked delivered.

ALTER TABLE services ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS fee_payment_mode VARCHAR(12) CHECK (fee_payment_mode IN ('company_upi', 'cash'));
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS fee_paid_at      TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION fn_setting_text(p_key TEXT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT nullif(trim(value), '') FROM site_settings WHERE key = p_key
$$;

-- ============ checkout quote ============

-- Delivery charge for these products (highest among their services) or for this service booking,
-- after the "first N orders free" offer.
-- p_list_service_ids: services the customer wrote their own list for (kirana…), priced by the shop bill.
DROP FUNCTION IF EXISTS fn_delivery_quote(INT, INT[], INT);
CREATE OR REPLACE FUNCTION fn_delivery_quote(p_customer_id INT, p_product_ids INT[], p_service_id INT,
                                             p_list_service_ids INT[] DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH svc AS (
    SELECT ARRAY(SELECT service_id FROM products WHERE id = ANY(coalesce(p_product_ids, ARRAY[]::INT[]))
                 UNION SELECT id FROM services WHERE id = ANY(coalesce(p_list_service_ids, ARRAY[]::INT[])) AND allows_list
                 UNION SELECT p_service_id WHERE p_service_id IS NOT NULL) AS ids
  ), base AS (
    SELECT coalesce((SELECT max(s.delivery_fee) FROM services s, svc WHERE s.id = ANY(svc.ids)), 0) AS fee
  ), w AS (
    SELECT * FROM fn_window_of((SELECT ids FROM svc))  -- daily_fresh.sql
  )
  SELECT jsonb_build_object(
    'base_fee', base.fee,
    'delivery_fee', fn_delivery_fee_for(p_customer_id, base.fee),
    'free_left', greatest(0, fn_setting_num('free_delivery_orders', 3)
                   - (SELECT count(*) FROM orders WHERE customer_id = p_customer_id AND status <> 'cancelled'))::int,
    -- items priced by the shop bill (vegetables, meat…)
    'on_bill', EXISTS (SELECT 1 FROM products p JOIN services s ON s.id = p.service_id
                        WHERE p.id = ANY(coalesce(p_product_ids, ARRAY[]::INT[])) AND s.price_on_bill)
               OR coalesce(cardinality(p_list_service_ids), 0) > 0,
    -- delivery time window and the slots the customer can pick
    'window', CASE WHEN w.win_from IS NOT NULL AND NOT w.conflict
                   THEN jsonb_build_object('from', w.win_from, 'to', w.win_to,
                                           'label', fn_hour_label(w.win_from) || ' – ' || fn_hour_label(w.win_to)) END,
    'window_conflict', w.conflict,
    'slots', CASE WHEN w.win_from IS NOT NULL AND NOT w.conflict THEN to_jsonb(fn_delivery_slots(w.win_from, w.win_to)) END)
  FROM base, w
$$;

-- ============ admin: charges per service ============

CREATE OR REPLACE FUNCTION fn_admin_delivery_charges() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'is_active', s.is_active, 'delivery_fee', s.delivery_fee,
           'products', (SELECT count(*) FROM products p WHERE p.service_id = s.id),
           'category_id', c.id, 'category_name', c.name, 'category_icon', c.icon)
         ORDER BY c.sort_order, c.name, s.sort_order, s.name), '[]'::jsonb)
    FROM services s JOIN categories c ON c.id = s.category_id
$$;

CREATE OR REPLACE PROCEDURE sp_set_service_delivery_fee(p_service_id INT, p_fee NUMERIC)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_fee IS NULL OR p_fee < 0 OR p_fee > 2000 THEN
    RAISE EXCEPTION 'Delivery charge must be between ₹0 and ₹2000' USING ERRCODE = '22023';
  END IF;
  UPDATE services SET delivery_fee = round(p_fee, 2) WHERE id = p_service_id AND delivery_fee <> round(p_fee, 2);
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM services WHERE id = p_service_id) THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Same charge for every service in a category. Returns how many services changed.
CREATE OR REPLACE FUNCTION fn_set_category_delivery_fee(p_category_id INT, p_fee NUMERIC) RETURNS INT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  n INT;
BEGIN
  IF p_fee IS NULL OR p_fee < 0 OR p_fee > 2000 THEN
    RAISE EXCEPTION 'Delivery charge must be between ₹0 and ₹2000' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = p_category_id) THEN
    RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE services SET delivery_fee = round(p_fee, 2) WHERE category_id = p_category_id AND delivery_fee <> round(p_fee, 2);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ============ agent: delivery charge received at the door ============

-- p_mode: 'company_upi' (customer paid the company QR) or 'cash'. Can be changed until the order is delivered.
CREATE OR REPLACE PROCEDURE sp_agent_fee_received(p_agent_id INT, p_order_id INT, p_mode TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('company_upi', 'cash') THEN
    RAISE EXCEPTION 'Choose how the customer paid' USING ERRCODE = '22023';
  END IF;
  IF v.delivery_fee <= 0 THEN
    RAISE EXCEPTION 'This order has no delivery charge' USING ERRCODE = '55000';
  END IF;
  IF v.status <> 'picked_up' THEN
    RAISE EXCEPTION 'Collect the delivery charge when you reach the customer' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'company_upi' AND fn_setting_text('company_upi_id') IS NULL THEN
    RAISE EXCEPTION 'The company UPI QR is not set up yet. Collect cash, or ask the admin to add the QR.' USING ERRCODE = '55000';
  END IF;
  IF v.fee_payment_mode IS NOT DISTINCT FROM p_mode THEN
    RETURN;
  END IF;

  UPDATE orders SET fee_payment_mode = p_mode, fee_paid_at = now() WHERE id = v.id;
  INSERT INTO order_events (order_id, status, note, actor_id)
  VALUES (v.id, v.status,
          CASE WHEN p_mode = 'company_upi' THEN 'Delivery charge ₹' || trim_scale(v.delivery_fee) || ' received on company UPI'
               ELSE 'Delivery charge ₹' || trim_scale(v.delivery_fee) || ' paid in cash' END,
          p_agent_id);
END $$;

-- ============ service areas ============

CREATE OR REPLACE TRIGGER localities_audit AFTER INSERT OR UPDATE OR DELETE ON localities FOR EACH ROW EXECUTE FUNCTION trg_audit();

CREATE OR REPLACE FUNCTION fn_admin_localities() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'name', l.name, 'pincode', l.pincode, 'lat', l.lat, 'lng', l.lng, 'is_active', l.is_active,
           'orders', (SELECT count(*) FROM orders o WHERE o.locality_id = l.id),
           'agents', (SELECT count(*) FROM agents a WHERE a.locality_id = l.id))
         ORDER BY l.is_active DESC, l.name), '[]'::jsonb)
    FROM localities l
$$;

-- Creates (p_id NULL) or updates an area. Areas are never deleted (old orders point to them): turn them off instead.
CREATE OR REPLACE FUNCTION fn_save_locality(p_id INT, p_name TEXT, p_pincode TEXT, p_lat NUMERIC, p_lng NUMERIC, p_is_active BOOLEAN)
RETURNS localities
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v localities;
BEGIN
  IF coalesce(trim(p_name), '') = '' OR length(trim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Enter the area name (up to 80 letters)' USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(p_pincode), '') IS NOT NULL AND trim(p_pincode) !~ '^[1-9]\d{5}$' THEN
    RAISE EXCEPTION 'Pincode must be 6 digits' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 6 AND 37.5 OR p_lng NOT BETWEEN 68 AND 97.5 THEN
    RAISE EXCEPTION 'Tap the map to set where this area is' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO localities (name, pincode, lat, lng, is_active)
    VALUES (trim(p_name), nullif(trim(p_pincode), ''), round(p_lat, 6), round(p_lng, 6), coalesce(p_is_active, true))
    RETURNING * INTO v;
  ELSE
    UPDATE localities SET name = trim(p_name), pincode = nullif(trim(p_pincode), ''), lat = round(p_lat, 6), lng = round(p_lng, 6),
                          is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Area not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;
