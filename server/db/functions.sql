-- Business logic for the admin panel. Re-runnable (CREATE OR REPLACE).
--
-- The API sets `app.user_id` for the transaction (see asActor in src/db.js), so triggers
-- know which admin made a change. Validation errors use SQLSTATE 22023 (→ HTTP 400) and
-- "not found" uses P0002 (→ HTTP 404).
-- Every function pins search_path to the app schema (FROM CURRENT at setup time), so the
-- triggers keep working when rows are edited from psql/pgAdmin with a different search_path.

-- ============ helpers ============

CREATE OR REPLACE FUNCTION fn_current_actor() RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::int
$$;

CREATE OR REPLACE FUNCTION fn_slugify(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- Returns p_base, or p_base-2, p_base-3 ... whichever is free in the given table.
CREATE OR REPLACE FUNCTION fn_unique_slug(p_table TEXT, p_base TEXT) RETURNS TEXT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_base TEXT := left(fn_slugify(p_base), 70);
  v_slug TEXT := v_base;
  v_n    INT  := 1;
  v_taken BOOLEAN;
BEGIN
  IF v_base = '' THEN v_base := 'item'; v_slug := v_base; END IF;
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE slug = $1)', p_table) INTO v_taken USING v_slug;
    EXIT WHEN NOT v_taken;
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;
  RETURN v_slug;
END $$;

-- ============ triggers ============

CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_service_price_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.base_price IS DISTINCT FROM OLD.base_price OR NEW.price_unit IS DISTINCT FROM OLD.price_unit THEN
    INSERT INTO service_price_history (service_id, old_price, new_price, old_unit, new_unit, changed_by)
    VALUES (NEW.id, OLD.base_price, NEW.base_price, OLD.price_unit, NEW.price_unit, fn_current_actor());
  END IF;
  RETURN NEW;
END $$;

-- Logs admin changes to categories/services. Changes without an actor (seed script) are not logged.
CREATE OR REPLACE FUNCTION trg_audit() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_actor   INT := fn_current_actor();
  v_details JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO admin_audit_log (actor_id, entity, entity_id, action, details)
    VALUES (v_actor, TG_TABLE_NAME, NEW.id, 'create', jsonb_build_object('name', NEW.name));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO admin_audit_log (actor_id, entity, entity_id, action, details)
    VALUES (v_actor, TG_TABLE_NAME, OLD.id, 'delete', jsonb_build_object('name', OLD.name));
    RETURN OLD;
  END IF;

  -- UPDATE: record only the fields that changed, as {field: {from, to}}.
  SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
    INTO v_details
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value AND n.key <> 'updated_at';

  IF v_details IS NOT NULL THEN
    INSERT INTO admin_audit_log (actor_id, entity, entity_id, action, details)
    VALUES (v_actor, TG_TABLE_NAME, NEW.id, 'update', v_details || jsonb_build_object('name', NEW.name));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_product_price_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price OR NEW.mrp IS DISTINCT FROM OLD.mrp THEN
    INSERT INTO product_price_history (product_id, old_price, new_price, old_mrp, new_mrp, changed_by)
    VALUES (NEW.id, OLD.price, NEW.price, OLD.mrp, NEW.mrp, fn_current_actor());
  END IF;
  RETURN NEW;
END $$;

-- Selling above the printed MRP is not allowed in India.
CREATE OR REPLACE FUNCTION trg_product_check_mrp() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.mrp IS NOT NULL AND NEW.price > NEW.mrp THEN
    RAISE EXCEPTION 'Selling price ₹% cannot be more than MRP ₹%', NEW.price, NEW.mrp USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER products_check_mrp BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION trg_product_check_mrp();
CREATE OR REPLACE TRIGGER products_touch   BEFORE UPDATE ON products   FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE OR REPLACE TRIGGER products_price_history AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION trg_product_price_history();
CREATE OR REPLACE TRIGGER products_audit   AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER categories_touch BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE OR REPLACE TRIGGER services_touch   BEFORE UPDATE ON services   FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE OR REPLACE TRIGGER services_price_history AFTER UPDATE ON services FOR EACH ROW EXECUTE FUNCTION trg_service_price_history();
CREATE OR REPLACE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER services_audit   AFTER INSERT OR UPDATE OR DELETE ON services   FOR EACH ROW EXECUTE FUNCTION trg_audit();

-- ============ categories ============

-- Creates (p_id NULL) or updates a category and returns the row.
CREATE OR REPLACE FUNCTION fn_save_category(
  p_id INT, p_name TEXT, p_icon TEXT, p_description TEXT,
  p_image_url TEXT, p_image_credit TEXT, p_color TEXT, p_is_active BOOLEAN
) RETURNS categories
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v categories;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Category name is required' USING ERRCODE = '22023';
  END IF;
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Color must look like #1a2b3c' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO categories (slug, name, icon, description, image_url, image_credit, color, is_active, sort_order)
    VALUES (fn_unique_slug('categories', p_name), trim(p_name), nullif(p_icon, ''), p_description,
            nullif(p_image_url, ''), nullif(p_image_credit, ''), coalesce(p_color, '#4f46e5'),
            coalesce(p_is_active, true), (SELECT coalesce(max(sort_order) + 1, 0) FROM categories))
    RETURNING * INTO v;
  ELSE
    UPDATE categories
       SET name = trim(p_name), icon = nullif(p_icon, ''), description = p_description,
           image_url = nullif(p_image_url, ''), image_credit = nullif(p_image_credit, ''),
           color = coalesce(p_color, color), is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id
    RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- A category can only be deleted once it has no services (hide it instead to keep them).
CREATE OR REPLACE PROCEDURE sp_delete_category(p_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM services WHERE category_id = p_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'This category still has % services. Delete or move them first, or hide the category.', v_count
      USING ERRCODE = '22023';
  END IF;
  DELETE FROM categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- ============ services ============

-- Creates (p_id NULL) or updates a service and returns the row.
CREATE OR REPLACE FUNCTION fn_save_service(
  p_id INT, p_category_id INT, p_name TEXT, p_description TEXT,
  p_image_url TEXT, p_image_credit TEXT, p_base_price NUMERIC, p_price_unit TEXT,
  p_eta_minutes INT, p_requires_license BOOLEAN, p_is_active BOOLEAN
) RETURNS services
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v services;
  v_cat_slug TEXT;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Service name is required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_base_price, 0) < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_eta_minutes, 0) < 0 THEN
    RAISE EXCEPTION 'Delivery time cannot be negative' USING ERRCODE = '22023';
  END IF;
  SELECT slug INTO v_cat_slug FROM categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Please choose a valid category' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO services (category_id, slug, name, description, image_url, image_credit, base_price,
                          price_unit, eta_minutes, requires_license, is_active, sort_order)
    VALUES (p_category_id, fn_unique_slug('services', v_cat_slug || '-' || p_name), trim(p_name), p_description,
            nullif(p_image_url, ''), nullif(p_image_credit, ''), coalesce(p_base_price, 0),
            nullif(trim(p_price_unit), ''), p_eta_minutes, coalesce(p_requires_license, false),
            coalesce(p_is_active, true),
            (SELECT coalesce(max(sort_order) + 1, 0) FROM services WHERE category_id = p_category_id))
    RETURNING * INTO v;
  ELSE
    UPDATE services
       SET category_id = p_category_id, name = trim(p_name), description = p_description,
           image_url = nullif(p_image_url, ''), image_credit = nullif(p_image_credit, ''),
           base_price = coalesce(p_base_price, 0), price_unit = nullif(trim(p_price_unit), ''),
           eta_minutes = p_eta_minutes, requires_license = coalesce(p_requires_license, false),
           is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id
    RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- Quick price edit from the services table.
CREATE OR REPLACE FUNCTION fn_set_service_price(p_id INT, p_price NUMERIC, p_unit TEXT DEFAULT NULL)
RETURNS services
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v services;
BEGIN
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'Enter a price of ₹0 or more' USING ERRCODE = '22023';
  END IF;
  UPDATE services
     SET base_price = round(p_price, 2), price_unit = coalesce(nullif(trim(p_unit), ''), price_unit)
   WHERE id = p_id
  RETURNING * INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE PROCEDURE sp_set_service_active(p_id INT, p_active BOOLEAN)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE services SET is_active = p_active WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE PROCEDURE sp_delete_service(p_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  DELETE FROM services WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- ============ products ============

-- Creates (p_id NULL) or updates a product and returns the row.
CREATE OR REPLACE FUNCTION fn_save_product(
  p_id INT, p_service_id INT, p_name TEXT, p_brand TEXT, p_description TEXT, p_icon TEXT,
  p_image_url TEXT, p_image_credit TEXT, p_unit TEXT, p_price NUMERIC, p_mrp NUMERIC,
  p_in_stock BOOLEAN, p_is_active BOOLEAN
) RETURNS products
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v products;
  v_service_slug TEXT;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Product name is required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_price, 0) < 0 OR coalesce(p_mrp, 0) < 0 THEN
    RAISE EXCEPTION 'Prices cannot be negative' USING ERRCODE = '22023';
  END IF;
  SELECT slug INTO v_service_slug FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Please choose which service this product belongs to' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO products (service_id, slug, name, brand, description, icon, image_url, image_credit,
                          unit, price, mrp, in_stock, is_active, sort_order)
    VALUES (p_service_id, fn_unique_slug('products', v_service_slug || '-' || coalesce(p_brand || '-', '') || p_name),
            trim(p_name), nullif(trim(p_brand), ''), nullif(p_description, ''), nullif(p_icon, ''),
            nullif(p_image_url, ''), nullif(p_image_credit, ''), nullif(trim(p_unit), ''),
            coalesce(p_price, 0), p_mrp, coalesce(p_in_stock, true), coalesce(p_is_active, true),
            (SELECT coalesce(max(sort_order) + 1, 0) FROM products WHERE service_id = p_service_id))
    RETURNING * INTO v;
  ELSE
    UPDATE products
       SET service_id = p_service_id, name = trim(p_name), brand = nullif(trim(p_brand), ''),
           description = nullif(p_description, ''), icon = nullif(p_icon, ''),
           image_url = nullif(p_image_url, ''), image_credit = nullif(p_image_credit, ''),
           unit = nullif(trim(p_unit), ''), price = coalesce(p_price, 0), mrp = p_mrp,
           in_stock = coalesce(p_in_stock, in_stock), is_active = coalesce(p_is_active, is_active)
     WHERE id = p_id
    RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- Quick price edit. p_field is 'price' or 'mrp'; a NULL/empty MRP clears it.
CREATE OR REPLACE FUNCTION fn_set_product_price(p_id INT, p_field TEXT, p_value NUMERIC)
RETURNS products
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v products;
BEGIN
  IF p_value < 0 THEN
    RAISE EXCEPTION 'Enter ₹0 or more' USING ERRCODE = '22023';
  END IF;
  IF p_field = 'price' THEN
    IF p_value IS NULL THEN
      RAISE EXCEPTION 'Enter a price' USING ERRCODE = '22023';
    END IF;
    UPDATE products SET price = round(p_value, 2) WHERE id = p_id RETURNING * INTO v;
  ELSIF p_field = 'mrp' THEN
    UPDATE products SET mrp = round(p_value, 2) WHERE id = p_id RETURNING * INTO v;
  ELSE
    RAISE EXCEPTION 'Unknown price field %', p_field USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END $$;

-- Toggles a product flag: 'in_stock' or 'is_active'.
CREATE OR REPLACE PROCEDURE sp_set_product_flag(p_id INT, p_flag TEXT, p_value BOOLEAN)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_flag = 'in_stock' THEN
    UPDATE products SET in_stock = p_value WHERE id = p_id;
  ELSIF p_flag = 'is_active' THEN
    UPDATE products SET is_active = p_value WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown flag %', p_flag USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE PROCEDURE sp_delete_product(p_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  DELETE FROM products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- ============ shared ============

-- Replaces the photo of a category, service or product in one call (used by the row image button).
CREATE OR REPLACE PROCEDURE sp_set_image(p_entity TEXT, p_id INT, p_url TEXT, p_credit TEXT DEFAULT NULL)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_entity NOT IN ('categories', 'services', 'products') THEN
    RAISE EXCEPTION 'Unknown item type %', p_entity USING ERRCODE = '22023';
  END IF;
  EXECUTE format('UPDATE %I SET image_url = $1, image_credit = $2 WHERE id = $3', p_entity)
    USING nullif(p_url, ''), nullif(p_credit, ''), p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Item not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Changes the pack size / quantity of a product ("500 ml", "20 L") or the price unit of a service ("per visit").
CREATE OR REPLACE PROCEDURE sp_set_unit(p_entity TEXT, p_id INT, p_unit TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_count INT;
BEGIN
  IF length(coalesce(p_unit, '')) > 30 THEN
    RAISE EXCEPTION 'Keep the quantity under 30 characters' USING ERRCODE = '22023';
  END IF;
  IF p_entity = 'products' THEN
    UPDATE products SET unit = nullif(trim(p_unit), '') WHERE id = p_id;
  ELSIF p_entity = 'services' THEN
    UPDATE services SET price_unit = nullif(trim(p_unit), '') WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown item type %', p_entity USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Item not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Raise/lower prices by a percentage, rounded to the nearest p_round_to rupees.
--   p_category_id: one category, or NULL for everything
--   p_target:      'services', 'products' or 'both'
-- Free (₹0) items stay free, and product prices never go above their MRP.
DROP PROCEDURE IF EXISTS sp_bulk_update_prices(INT, NUMERIC, INT, INT);
CREATE OR REPLACE PROCEDURE sp_bulk_update_prices(
  p_category_id INT, p_percent NUMERIC, p_round_to INT DEFAULT 1,
  p_target TEXT DEFAULT 'services', INOUT p_updated INT DEFAULT 0
)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_percent IS NULL OR p_percent = 0 OR p_percent < -90 OR p_percent > 500 THEN
    RAISE EXCEPTION 'Percentage must be between -90%% and 500%% (and not 0)' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_round_to, 0) < 1 THEN
    RAISE EXCEPTION 'Round-to must be at least ₹1' USING ERRCODE = '22023';
  END IF;
  IF p_target NOT IN ('services', 'products', 'both') THEN
    RAISE EXCEPTION 'Choose services, products or both' USING ERRCODE = '22023';
  END IF;
  p_updated := 0;

  IF p_target IN ('services', 'both') THEN
    UPDATE services
       SET base_price = greatest(p_round_to, round(base_price * (1 + p_percent / 100) / p_round_to) * p_round_to)
     WHERE base_price > 0
       AND (p_category_id IS NULL OR category_id = p_category_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    p_updated := p_updated + v_count;
  END IF;

  IF p_target IN ('products', 'both') THEN
    UPDATE products p
       SET price = least(coalesce(p.mrp, 'Infinity'),
                         greatest(p_round_to, round(p.price * (1 + p_percent / 100) / p_round_to) * p_round_to))
      FROM services s
     WHERE s.id = p.service_id
       AND p.price > 0
       AND (p_category_id IS NULL OR s.category_id = p_category_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    p_updated := p_updated + v_count;
  END IF;
END $$;

-- ============ settings ============

-- Upserts every key in a JSON object, e.g. {"banner_title": "..."}.
CREATE OR REPLACE PROCEDURE sp_save_settings(p_settings JSONB)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO site_settings (key, value, updated_at)
  SELECT key, value, now() FROM jsonb_each_text(p_settings)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  INSERT INTO admin_audit_log (actor_id, entity, action, details)
  VALUES (fn_current_actor(), 'site_settings', 'update', p_settings);
END $$;

-- ============ dashboard ============

CREATE OR REPLACE FUNCTION fn_admin_stats() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'categories',        (SELECT count(*) FROM categories),
    'active_categories', (SELECT count(*) FROM categories WHERE is_active),
    'services',          (SELECT count(*) FROM services),
    'active_services',   (SELECT count(*) FROM services WHERE is_active),
    'customers',         (SELECT count(*) FROM users WHERE role = 'customer'),
    'partners',          (SELECT count(*) FROM agents WHERE status = 'active'),
    'admins',            (SELECT count(*) FROM users WHERE role = 'admin'),
    'products',          (SELECT count(*) FROM products),
    'active_products',   (SELECT count(*) FROM products WHERE is_active),
    'out_of_stock',      (SELECT count(*) FROM products WHERE is_active AND NOT in_stock),
    'price_changes_7d',  (SELECT count(*) FROM service_price_history WHERE changed_at > now() - interval '7 days')
                       + (SELECT count(*) FROM product_price_history WHERE changed_at > now() - interval '7 days'),
    'avg_price',         (SELECT round(avg(base_price)) FROM services WHERE is_active AND base_price > 0),
    'per_category', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.sort_order), '[]'::jsonb) FROM (
        SELECT c.name, c.icon, c.color, c.sort_order,
               count(s.id) FILTER (WHERE s.is_active) AS active,
               count(s.id) AS total
          FROM categories c LEFT JOIN services s ON s.category_id = c.id
         GROUP BY c.id
      ) x
    )
  )
$$;
