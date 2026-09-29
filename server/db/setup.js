// Creates the app schema, tables, functions/procedures, seeds the service catalog, site settings
// and a default admin. Safe to re-run: existing rows are left alone, so edits made in the admin
// panel are never overwritten.
//
//   npm run db:setup                        -> create/upgrade schema, add missing seed rows
//   npm run db:setup -- --refresh-images    -> also reset seeded categories/services to images.json photos
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool, SCHEMA } from '../src/db.js';
import { categories, localities, products, serviceSkills, serviceTypes } from './catalog.js';

const refreshImages = process.argv.includes('--refresh-images');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sql = (file) => readFile(new URL(file, import.meta.url), 'utf8');
// images.json is produced by fetch-images.js; a missing entry leaves the image empty (UI shows an emoji tile).
const images = JSON.parse(await sql('./images.json').catch(() => '{}'));
const image = (keywords) => images[keywords] || {};

const defaultSettings = {
  banner_title: 'What do you need today?',
  banner_subtitle: 'Water cans, plumbers, kirana, medicines, bike repair and more — from trusted local partners near you.',
  announcement: '🎉 Free delivery on your first 3 orders across Hyderabad!',
  support_phone: '+91 98765 43210',
  service_city: 'Hyderabad, Telangana',
  delivery_fee: '30',
  free_delivery_orders: '3',
  agent_pay_per_order: '25',
  agent_max_active_orders: '1',
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
    for (const [pi, [name, brand, unit, price, mrp, icon]] of items.entries()) {
      const r = await client.query(
        `INSERT INTO products (service_id, slug, name, brand, unit, price, mrp, icon, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
        [svc.rows[0].id, `${svc.rows[0].slug}-${slugify(name)}`, name, brand || null, unit, price, mrp, icon, pi]
      );
      productCount += r.rowCount;
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

  // Order numbers start at #1001.
  await client.query(`SELECT setval('orders_id_seq', 1000) WHERE NOT EXISTS (SELECT 1 FROM orders)`);

  for (const [name, pincode, lat, lng] of localities) {
    await client.query(
      'INSERT INTO localities (name, pincode, lat, lng) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING',
      [name, pincode, lat, lng]
    );
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
