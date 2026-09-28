// Creates the app schema, tables, functions/procedures, seeds the service catalog, site settings
// and a default admin. Safe to re-run: existing rows are left alone, so edits made in the admin
// panel are never overwritten.
//
//   npm run db:setup                        -> create/upgrade schema, add missing seed rows
//   npm run db:setup -- --refresh-images    -> also reset seeded categories/services to images.json photos
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool, SCHEMA } from '../src/db.js';
import { categories } from './catalog.js';

const refreshImages = process.argv.includes('--refresh-images');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sql = (file) => readFile(new URL(file, import.meta.url), 'utf8');
// images.json is produced by fetch-images.js; a missing entry leaves the image empty (UI shows an emoji tile).
const images = JSON.parse(await sql('./images.json').catch(() => '{}'));
const image = (keywords) => images[keywords] || {};

const defaultSettings = {
  banner_title: 'What do you need today?',
  banner_subtitle: 'Water cans, plumbers, kirana, medicines, bike repair and more — from trusted local partners near you.',
  announcement: '🎉 Free delivery on your first 3 orders!',
  support_phone: '+91 98765 43210',
  service_city: 'Hyderabad',
};

const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(await sql('./schema.sql'));
  await client.query(await sql('./functions.sql'));

  await client.query('BEGIN');
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
        `INSERT INTO services (category_id, slug, name, image_url, image_credit, base_price, price_unit, eta_minutes, requires_license, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (slug) DO NOTHING`,
        [rows[0].id, slug, name, sImg.url, sImg.credit, price, unit, eta, license, si]
      );
      if (refreshImages && sImg.url) {
        const r = await client.query('UPDATE services SET image_url=$2, image_credit=$3 WHERE slug=$1', [slug, sImg.url, sImg.credit]);
        refreshed += r.rowCount;
      }
    }
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    await client.query('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }

  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const admin = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ('admin', $1, 'Administrator', 'admin') ON CONFLICT (username) DO NOTHING RETURNING id`,
    [await bcrypt.hash(adminPassword, 10)]
  );
  await client.query('COMMIT');

  const counts = await client.query('SELECT (SELECT count(*) FROM categories) c, (SELECT count(*) FROM services) s');
  console.log(`Schema "${SCHEMA}" ready: ${counts.rows[0].c} categories, ${counts.rows[0].s} services.`);
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
