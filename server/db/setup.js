// Creates the app schema + tables, seeds the service catalog and a default admin.
// Safe to re-run: existing rows are updated, not duplicated.
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool, SCHEMA } from '../src/db.js';
import { categories } from './catalog.js';

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// images.json is produced by fetch-images.js; a missing entry leaves the image empty (UI shows an emoji tile).
const images = JSON.parse(await readFile(new URL('./images.json', import.meta.url), 'utf8').catch(() => '{}'));
const image = (keywords) => images[keywords] || {};

const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));

  await client.query('BEGIN');
  for (const [ci, c] of categories.entries()) {
    const img = image(c.image);
    const { rows } = await client.query(
      `INSERT INTO categories (slug, name, icon, description, image_url, image_credit, color, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon,
         description=EXCLUDED.description, image_url=EXCLUDED.image_url, image_credit=EXCLUDED.image_credit,
         color=EXCLUDED.color, sort_order=EXCLUDED.sort_order
       RETURNING id`,
      [c.slug, c.name, c.icon, c.description, img.url, img.credit, c.color, ci]
    );
    for (const [si, [name, kw, price, unit, eta, license = false]] of c.services.entries()) {
      const sImg = image(kw);
      await client.query(
        `INSERT INTO services (category_id, slug, name, image_url, image_credit, base_price, price_unit, eta_minutes, requires_license, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name,
           image_url=EXCLUDED.image_url, image_credit=EXCLUDED.image_credit, base_price=EXCLUDED.base_price,
           price_unit=EXCLUDED.price_unit, eta_minutes=EXCLUDED.eta_minutes,
           requires_license=EXCLUDED.requires_license, sort_order=EXCLUDED.sort_order`,
        [rows[0].id, `${c.slug}-${slugify(name)}`, name, sImg.url, sImg.credit, price, unit, eta, license, si]
      );
    }
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
  if (admin.rowCount) console.log(`Created admin user -> username: admin  password: ${adminPassword}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('DB setup failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
