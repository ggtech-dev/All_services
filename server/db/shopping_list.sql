-- Kirana and other "price as per shop bill" services. Re-runnable. Runs after daily_fresh.sql, before delivery.sql.
--  * the customer may write their own list (item + quantity) and/or send a photo of a handwritten list
--  * the customer may choose a shop (from the admin's list, or type one); the agent then buys only there

ALTER TABLE services ADD COLUMN IF NOT EXISTS allows_list BOOLEAN NOT NULL DEFAULT false; -- "Write your list" tab

ALTER TABLE orders ADD COLUMN IF NOT EXISTS list_photo          TEXT;         -- private file (photo of the list)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preferred_shop_id   INT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preferred_shop_name VARCHAR(80);  -- a shop typed by the customer

-- Local shops the agents buy from. service_ids: which services the shop sells for (vegetables, meat, kirana…).
CREATE TABLE IF NOT EXISTS shops (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  locality_id INT          REFERENCES localities(id),
  address     VARCHAR(200),
  phone       VARCHAR(15),
  service_ids INT[]        NOT NULL DEFAULT '{}',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shops_name_area_idx ON shops (lower(name), coalesce(locality_id, 0));
CREATE OR REPLACE TRIGGER shops_touch BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE OR REPLACE TRIGGER shops_audit AFTER INSERT OR UPDATE OR DELETE ON shops FOR EACH ROW EXECUTE FUNCTION trg_audit();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_preferred_shop_fk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_preferred_shop_fk FOREIGN KEY (preferred_shop_id) REFERENCES shops(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============ shops ============

-- Creates (p_id NULL) or updates a shop.
CREATE OR REPLACE FUNCTION fn_save_shop(p_id INT, p_name TEXT, p_locality_id INT, p_address TEXT, p_phone TEXT,
                                        p_service_ids INT[], p_is_active BOOLEAN) RETURNS shops
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v shops;
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_services INT[];
BEGIN
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Enter the shop name' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone <> '' AND v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number (or leave it empty)' USING ERRCODE = '22023';
  END IF;
  IF p_locality_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM localities WHERE id = p_locality_id) THEN
    RAISE EXCEPTION 'Choose the area' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT s.id) INTO v_services FROM services s WHERE s.id = ANY(coalesce(p_service_ids, '{}'));
  IF v_services IS NULL THEN
    RAISE EXCEPTION 'Choose what the shop sells (vegetables, meat, kirana…)' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO shops (name, locality_id, address, phone, service_ids, is_active)
    VALUES (trim(p_name), p_locality_id, nullif(trim(p_address), ''), nullif(v_phone, ''), v_services, coalesce(p_is_active, true))
    RETURNING * INTO v;
  ELSE
    UPDATE shops SET name = trim(p_name), locality_id = p_locality_id, address = nullif(trim(p_address), ''),
                     phone = nullif(v_phone, ''), service_ids = v_services, is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shop not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fn_admin_shops() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', sh.id, 'name', sh.name, 'locality_id', sh.locality_id, 'locality_name', l.name,
           'address', sh.address, 'phone', sh.phone, 'service_ids', sh.service_ids, 'is_active', sh.is_active,
           'services', (SELECT coalesce(jsonb_agg(s.name ORDER BY s.sort_order), '[]') FROM services s WHERE s.id = ANY(sh.service_ids)),
           'orders', (SELECT count(*) FROM orders o WHERE o.preferred_shop_id = sh.id))
         ORDER BY sh.is_active DESC, sh.name), '[]'::jsonb)
    FROM shops sh LEFT JOIN localities l ON l.id = sh.locality_id
$$;

-- Shops a customer can choose for a cart: active, selling for at least one of these services.
CREATE OR REPLACE FUNCTION fn_shops_for(p_service_ids INT[]) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', sh.id, 'name', sh.name, 'locality_name', l.name) ORDER BY sh.name), '[]'::jsonb)
    FROM shops sh LEFT JOIN localities l ON l.id = sh.locality_id
   WHERE sh.is_active AND sh.service_ids && coalesce(p_service_ids, '{}')
$$;

-- Sections inside a shop (kirana: Rice & Grains, Dals & Pulses, Oils & Ghee…), shown as filter chips.
ALTER TABLE products ADD COLUMN IF NOT EXISTS section VARCHAR(40);
