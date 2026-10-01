// Creates the app schema, tables, functions/procedures, seeds the service catalog, site settings
// and a default admin. Safe to re-run: existing rows are left alone, so edits made in the admin
// panel are never overwritten.
//
//   npm run db:setup                        -> create/upgrade schema, add missing seed rows
//   npm run db:setup -- --refresh-images    -> also reset seeded categories/services to images.json photos
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool, SCHEMA } from '../src/db.js';
import { categories, localities, products, serviceOptions, serviceSkills, serviceTypes } from './catalog.js';

const refreshImages = process.argv.includes('--refresh-images');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sql = (file) => readFile(new URL(file, import.meta.url), 'utf8');
// images.json is produced by fetch-images.js; a missing entry leaves the image empty (UI shows an emoji tile).
const images = JSON.parse(await sql('./images.json').catch(() => '{}'));
const image = (keywords) => images[keywords] || {};

const defaultSettings = {
  banner_title: 'What do you need today?',
  banner_subtitle: 'Water cans, plumbers, kirana, medicines, bike repair and more — from trusted local partners near you.',
  announcement: '🎉 Free delivery on your first 3 orders across Siddipet!',
  support_phone: '+91 98765 43210',
  service_city: 'Siddipet, Telangana',
  delivery_fee: '30', // starting delivery charge for shop services; after that it is set per service (admin → Delivery charges)
  free_delivery_orders: '3',
  agent_pay_per_order: '25',
  agent_max_active_orders: '1',
  require_delivery_otp: '0', // 1 = agent must enter the customer's OTP to mark delivered
};
// Settings still holding an older default are moved to the new one; admin-edited values are kept.
const oldDefaults = { service_city: 'Hyderabad', announcement: '🎉 Free delivery on your first 3 orders!' };

const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(await sql('./schema.sql'));
  await client.query(await sql('./functions.sql'));
  await client.query(await sql('./orders.sql'));
  await client.query(await sql('./auth.sql'));
  await client.query(await sql('./promotions.sql'));
  await client.query(await sql('./reports.sql'));
  await client.query(await sql('./shop_bill.sql'));
  await client.query(await sql('./daily_fresh.sql')); // before delivery.sql (its quote uses the delivery windows)
  await client.query(await sql('./shopping_list.sql')); // customer's own list, list photo, shops
  await client.query(await sql('./delivery.sql'));

  await client.query('BEGIN');

  // Service types first: services and agents refer to them. Existing names/titles edited by the admin are kept.
  for (const [i, [code, name, title, icon]] of serviceTypes.entries()) {
    await client.query(
      `INSERT INTO service_types (code, name, agent_title, icon, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO NOTHING`,
      [code, name, title, icon, i]
    );
  }

  let refreshed = 0;
  for (const [ci, c] of categories.entries()) {
    const img = image(c.image);
    const { rows } = await client.query(
      `INSERT INTO categories (slug, name, icon, description, image_url, image_credit, color, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
      [c.slug, c.name, c.icon, c.description, img.url, img.credit, c.color, ci]
    );
    if (refreshImages && img.url) {
      await client.query('UPDATE categories SET image_url=$2, image_credit=$3 WHERE id=$1', [rows[0].id, img.url, img.credit]);
      refreshed++;
    }

    for (const [si, [name, kw, price, unit, eta, license = false]] of c.services.entries()) {
      const sImg = image(kw);
      const slug = `${c.slug}-${slugify(name)}`;
      await client.query(
        `INSERT INTO services (category_id, slug, name, image_url, image_credit, base_price, price_unit, eta_minutes, requires_license, sort_order, skill_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (slug) DO NOTHING`,
        [rows[0].id, slug, name, sImg.url, sImg.credit, price, unit, eta, license, si, serviceSkills[name] || 'delivery']
      );
      // Services created before types existed get their type once; later admin changes are kept.
      await client.query('UPDATE services SET skill_code = $2 WHERE slug = $1 AND skill_code IS NULL', [slug, serviceSkills[name] || 'delivery']);
      if (refreshImages && sImg.url) {
        const r = await client.query('UPDATE services SET image_url=$2, image_credit=$3 WHERE slug=$1', [slug, sImg.url, sImg.credit]);
        refreshed += r.rowCount;
      }
    }
  }

  let productCount = 0;
  for (const [key, items] of Object.entries(products)) {
    const catSlug = key.slice(0, key.indexOf('/'));
    const serviceName = key.slice(key.indexOf('/') + 1); // service names can contain "/"
    const svc = await client.query('SELECT id, slug FROM services WHERE slug = $1', [`${catSlug}-${slugify(serviceName)}`]);
    if (!svc.rows[0]) throw new Error(`Seed products: service "${key}" not found`);
    for (const [pi, [name, brand, unit, price, mrp, icon, sellBy = 'pack', imageKw, noteOptions, section]] of items.entries()) {
      const img = imageKw ? image(imageKw) : {};
      const slug = `${svc.rows[0].slug}-${slugify(name)}`;
      const r = await client.query(
        `INSERT INTO products (service_id, slug, name, brand, unit, price, mrp, icon, sort_order, sell_by, image_url, image_credit, note_options, section)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (slug) DO NOTHING`,
        [svc.rows[0].id, slug, name, brand || null, unit, price, mrp, icon, pi, sellBy, img.url, img.credit, noteOptions || null, section || null]
      );
      if (section) await client.query('UPDATE products SET section = $2 WHERE slug = $1 AND section IS NULL', [slug, section]);
      productCount += r.rowCount;
      if (img.url) {
        // a photo fetched later fills an empty one; --refresh-images replaces it (admin-uploaded photos are kept otherwise)
        const u = await client.query(
          `UPDATE products SET image_url = $2, image_credit = $3
            WHERE slug = $1 AND ($4 OR image_url IS NULL) AND image_url IS DISTINCT FROM $2`,
          [slug, img.url, img.credit, refreshImages]
        );
        refreshed += u.rowCount;
      }
    }
  }

  // One-time (2026-09-29): plumbing, electrical, appliance, cleaning, carpentry and painting were merged into
  // one "Home services" type, and "Delivery" was renamed "Regular agents". Guarded so later admin edits stay.
  const merged = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_home_service'");
  if (!merged.rowCount) {
    const OLD = ['plumbing', 'electrical', 'appliance', 'cleaning', 'carpentry', 'painting'];
    await client.query('UPDATE services SET skill_code = $1 WHERE skill_code = ANY ($2)', ['home_service', OLD]);
    await client.query('UPDATE orders SET skill_code = $1 WHERE skill_code = ANY ($2) AND status = $3', ['home_service', OLD, 'placed']);
    await client.query(
      `UPDATE agents SET skills = ARRAY(SELECT DISTINCT CASE WHEN x = ANY ($1) THEN 'home_service' ELSE x END FROM unnest(skills) x ORDER BY 1)
        WHERE skills && $1`,
      [OLD]
    );
    await client.query('UPDATE service_types SET is_active = false WHERE code = ANY ($1)', [OLD]);
    await client.query("UPDATE service_types SET name = 'Regular agents' WHERE code = 'delivery' AND name = 'Delivery'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_home_service', '2026-09-29')");
    console.log('Merged specialist home types into "Home services"; Delivery renamed to "Regular agents".');
  }

  // Any other service without a type (e.g. added by the admin before types existed) becomes 'general'.
  await client.query("UPDATE services SET skill_code = 'general' WHERE skill_code IS NULL");
  // Old orders get the type of their first item's service.
  await client.query(
    `UPDATE orders o SET skill_code = coalesce((
        SELECT s.skill_code FROM order_items i
          LEFT JOIN products p ON p.id = i.product_id
          JOIN services s ON s.id = coalesce(i.service_id, p.service_id)
         WHERE i.order_id = o.id ORDER BY i.id LIMIT 1), 'delivery')
      WHERE skill_code IS NULL`
  );
  await client.query("ALTER TABLE services ALTER COLUMN skill_code SET DEFAULT 'general', ALTER COLUMN skill_code SET NOT NULL");
  await client.query("ALTER TABLE orders ALTER COLUMN skill_code SET DEFAULT 'delivery', ALTER COLUMN skill_code SET NOT NULL");

  // Sample promotions, added once (if the admin deletes them they stay deleted). Images reuse the service photos.
  const promosSeeded = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_promotions'");
  if (!promosSeeded.rowCount) {
    const samples = [
      // [name, title, subtitle, cta, link_type, link_value, placement, bg, image from service slug]
      ['Free delivery launch offer', 'Free delivery on your first 3 orders 🎉', 'Milk, vegetables, kirana & more — delivered in about 30 minutes across Siddipet', 'Shop now', 'category', 'food-daily', 'carousel', '#16a34a', 'food-daily-vegetable-delivery'],
      ['Plumber in 60 minutes', 'Plumber at your door in 60 minutes', 'Leaking tap? Blocked drain? Verified home service experts near you', 'Book a plumber', 'service', 'home-services-plumber-on-demand', 'carousel', '#1d4ed8', 'home-services-plumber-on-demand'],
      ['Morning milk', 'Fresh Vijaya milk every morning 🥛', 'Toned milk ₹28 · curd · ghee · paneer', 'Order milk', 'service', 'food-daily-milk-delivery', 'carousel', '#b45309', 'food-daily-milk-delivery'],
      ['AC service tile', 'AC service', 'Beat the heat — from ₹499', 'Book', 'service', 'home-services-ac-service', 'tile', '#0e7490', 'home-services-ac-service'],
      ['Scrap pickup tile', 'Sell your scrap', 'We pay you for paper, plastic & metal', 'Schedule pickup', 'category', 'recycling', 'tile', '#15803d', 'recycling-scrap-collection'],
      ['Car wash tile', 'Car wash at home', 'Shiny car without leaving home', 'Book', 'service', 'vehicle-car-wash-at-home', 'tile', '#7c3aed', 'vehicle-car-wash-at-home'],
    ];
    for (const [i, [name, title, subtitle, cta, type, value, placement, bg, imgSlug]] of samples.entries()) {
      await client.query(
        `INSERT INTO promotions (name, title, subtitle, cta_text, link_type, link_value, placement, bg_color, sort_order, image_url, image_credit)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, s.image_url, s.image_credit FROM (SELECT 1) x
           LEFT JOIN services s ON s.slug = $10`,
        [name, title, subtitle, cta, type, value, placement, bg, i, imgSlug]
      );
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_promotions', '2026-09-29')");
    console.log(`Added ${samples.length} sample promotions.`);
  }

  // One time: the daily services (fresh vegetables 6–10 AM, fresh meat & fish, fresh milk 6–9 AM) — price as per
  // shop bill, delivery window, highlighted on the home page, the usual delivery charge, and promotions for them.
  // Later admin changes are kept.
  const dailySeeded = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_daily_fresh'");
  if (!dailySeeded.rowCount) {
    for (const [name, o] of Object.entries(serviceOptions)) {
      const slug = `food-daily-${slugify(name)}`;
      await client.query(
        `UPDATE services SET price_on_bill = $2, window_from = $3, window_to = $4, is_featured = $5,
                description = coalesce(description, $6), delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30)
          WHERE slug = $1`,
        [slug, !!o.price_on_bill, o.window?.[0] ?? null, o.window?.[1] ?? null, !!o.featured, o.description]
      );
    }
    const dailyPromos = [
      // [name, title, subtitle, cta, service slug, placement, bg, order]
      ['Fresh vegetables 6–10 AM', '🥬 Fresh vegetables every morning', 'Delivered 6–10 AM · choose in kg · pay as per market price', 'Order vegetables', 'food-daily-fresh-vegetables', 'carousel', '#15803d', -3],
      ['Fresh meat & fish', '🍗 Fresh chicken, mutton, prawns & fish', 'Cut the way you like — curry cut, boneless, fry pieces', 'Order now', 'food-daily-daily-fresh-meat-fish', 'carousel', '#b91c1c', -2],
      ['Fresh milk 6–9 AM', '🥛 Fresh milk at your door', 'Organic & packet milk · every morning 6–9 AM', 'Order milk', 'food-daily-fresh-milk', 'carousel', '#0369a1', -1],
      ['Fresh vegetables tile', 'Fresh vegetables', '6–10 AM · market price', 'Order', 'food-daily-fresh-vegetables', 'tile', '#15803d', -3],
      ['Fresh meat & fish tile', 'Fresh meat & fish', 'Cut the way you like', 'Order', 'food-daily-daily-fresh-meat-fish', 'tile', '#b91c1c', -2],
      ['Fresh milk tile', 'Fresh milk', 'Every morning 6–9 AM', 'Order', 'food-daily-fresh-milk', 'tile', '#0369a1', -1],
    ];
    for (const [name, title, subtitle, cta, slug, placement, bg, order] of dailyPromos) {
      await client.query(
        `INSERT INTO promotions (name, title, subtitle, cta_text, link_type, link_value, placement, bg_color, sort_order, image_url, image_credit)
         SELECT $1, $2, $3, $4, 'service', $5, $6, $7, $8, s.image_url, s.image_credit FROM services s WHERE s.slug = $5`,
        [name, title, subtitle, cta, slug, placement, bg, order]
      );
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_daily_fresh', current_date::text)");
    console.log('Added the daily services (vegetables, meat & fish, milk) and their promotions.');
  }

  // One time (Phase 2): the top services, in this order — Fresh Vegetables, Fresh Meat & Fish, Fresh Milk, Kirana.
  // Kirana: no fixed prices (shop bill), customers may also write their own list or send a photo of it.
  // Food & Daily-Use comes first on the home page. Later admin changes are kept.
  const kiranaDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_kirana_list'");
  if (!kiranaDone.rowCount) {
    await client.query(`UPDATE services SET sort_order = sort_order + 10
                         WHERE category_id = (SELECT id FROM categories WHERE slug = 'food-daily')`);
    const top = ['food-daily-fresh-vegetables', 'food-daily-daily-fresh-meat-fish', 'food-daily-fresh-milk', 'food-daily-kirana-delivery'];
    for (const [i, slug] of top.entries()) await client.query('UPDATE services SET sort_order = $2 WHERE slug = $1', [slug, i]);
    await client.query(
      `UPDATE services SET price_on_bill = true, allows_list = true, is_featured = true, price_unit = 'as per shop bill',
              description = 'Groceries from your nearby kirana shop. Pick items from our list, write your own list, or send a photo of it — you pay as per the shop bill.'
        WHERE slug = 'food-daily-kirana-delivery'`
    );
    await client.query("UPDATE categories SET sort_order = -1 WHERE slug = 'food-daily'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_kirana_list', current_date::text)");
    console.log('Kirana: price as per shop bill + own list; top services ordered.');
  }

  // One time: the full kirana catalog (db/kirana.js) replaces the first short list. Old items that are not in the
  // catalog any more are hidden (not deleted: old orders point to them).
  const kiranaCatalog = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_kirana_catalog'");
  if (!kiranaCatalog.rowCount) {
    const keep = products['food-daily/Kirana Delivery'].map(([name]) => `food-daily-kirana-delivery-${slugify(name)}`);
    const hidden = await client.query(
      `UPDATE products SET is_active = false WHERE service_id = (SELECT id FROM services WHERE slug = 'food-daily-kirana-delivery')
         AND NOT (slug = ANY($1)) AND is_active`,
      [keep]
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_kirana_catalog', current_date::text)");
    console.log(`Kirana catalog: ${keep.length} items (${hidden.rowCount} old items hidden).`);
  }

  // One time: the Pooja Store — like Kirana (price as per shop bill, customers may write their own list or send a
  // photo), right after Kirana, regular agents. The pooja items move out of Kirana (hidden there, not deleted).
  const poojaDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_pooja_store'");
  if (!poojaDone.rowCount) {
    await client.query(
      `UPDATE services SET price_on_bill = true, allows_list = true, skill_code = 'delivery', sort_order = 4,
              price_unit = 'as per shop bill', delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30),
              description = 'Everything for your daily pooja — diyas, agarbatti, camphor, kumkum, flowers and more. Pick items, write your own list or send a photo — you pay as per the shop bill.'
        WHERE slug = 'food-daily-pooja-store'`
    );
    await client.query(
      `UPDATE products SET is_active = false
        WHERE service_id = (SELECT id FROM services WHERE slug = 'food-daily-kirana-delivery') AND section = 'Pooja Needs'`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_pooja_store', current_date::text)");
    console.log('Pooja Store added (pooja items moved out of Kirana).');
  }

  // Order numbers start at #1001.
  await client.query(`SELECT setval('orders_id_seq', 1000) WHERE NOT EXISTS (SELECT 1 FROM orders)`);

  for (const [name, pincode, lat, lng] of localities) {
    await client.query(
      'INSERT INTO localities (name, pincode, lat, lng) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING',
      [name, pincode, lat, lng]
    );
  }

  // One time: launch in Siddipet. The old Hyderabad areas are switched off (not deleted: old orders point to them)
  // and "Hyderabad" in the home page texts becomes "Siddipet". Admin edits after this are kept.
  const siddipet = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_siddipet'");
  if (!siddipet.rowCount) {
    await client.query('UPDATE localities SET is_active = (name = ANY($1))', [localities.map(([name]) => name)]);
    await client.query("UPDATE site_settings SET value = replace(value, 'Hyderabad', 'Siddipet') WHERE key IN ('announcement', 'banner_subtitle')");
    await client.query("UPDATE promotions SET title = replace(title, 'Hyderabad', 'Siddipet'), subtitle = replace(subtitle, 'Hyderabad', 'Siddipet')");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_siddipet', current_date::text)");
  }

  // One time: delivery charge per service. Shop services (with products) start at the old single delivery fee,
  // bookings at ₹0. Admin → Delivery charges changes them.
  const perService = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_service_fees'");
  if (!perService.rowCount) {
    await client.query(`UPDATE services s SET delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30)
                          WHERE EXISTS (SELECT 1 FROM products p WHERE p.service_id = s.id)`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_service_fees', current_date::text)");
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    await client.query('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
    if (oldDefaults[key]) {
      await client.query('UPDATE site_settings SET value = $2 WHERE key = $1 AND value = $3', [key, value, oldDefaults[key]]);
    }
  }

  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const admin = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ('admin', $1, 'Administrator', 'admin') ON CONFLICT (username) DO NOTHING RETURNING id`,
    [await bcrypt.hash(adminPassword, 10)]
  );
  await client.query('COMMIT');

  const counts = await client.query(
    'SELECT (SELECT count(*) FROM categories) c, (SELECT count(*) FROM services) s, (SELECT count(*) FROM products) p'
  );
  const { c, s, p } = counts.rows[0];
  console.log(`Schema "${SCHEMA}" ready: ${c} categories, ${s} services, ${p} products (${productCount} new).`);
  if (refreshImages) console.log(`Refreshed ${refreshed} images from images.json.`);
  if (admin.rowCount) console.log(`Created admin user -> username: admin  password: ${adminPassword}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('DB setup failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
