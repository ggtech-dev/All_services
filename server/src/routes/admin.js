import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import { query, asActor } from '../db.js';
import { HREF_SQL } from './promotions.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const UPLOAD_DIR = path.resolve(import.meta.dirname, '../../uploads');

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Wraps async handlers so thrown errors reach the error middleware.
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), { status: 400 }), ok);
  },
});

// '' / missing → null; anything that is not a real number (e.g. "abc" → NaN) is a 400, never stored.
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Enter a valid number'), { status: 400 });
  return n;
};
const bool = (v) => (v === undefined || v === null ? null : Boolean(v));

// ---------- uploaded photo cleanup ----------
// When a photo is replaced or removed (or its row deleted), the old file in /uploads is deleted,
// unless another category/service/product still uses it. Pasted external URLs are never touched.
async function imageUrlsOf(entity, id) {
  const products = entity === 'services' ? ' UNION ALL SELECT image_url FROM products WHERE service_id = $1' : '';
  const { rows } = await query(`SELECT image_url FROM ${entity} WHERE id = $1${products}`, [id]);
  return rows.map((r) => r.image_url).filter((u) => u?.startsWith('/uploads/'));
}

async function removeUnusedUploads(urls) {
  for (const url of new Set(urls)) {
    const { rows } = await query(
      `SELECT 1 FROM categories WHERE image_url = $1 UNION ALL
       SELECT 1 FROM services   WHERE image_url = $1 UNION ALL
       SELECT 1 FROM products   WHERE image_url = $1 UNION ALL
       SELECT 1 FROM promotions WHERE image_url = $1 LIMIT 1`,
      [url]
    );
    if (!rows.length) await unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
  }
}

// Middleware: remember the row's current photos, clean them up once the request succeeded.
const cleansOldImages = (entity) => h(async (req, res, next) => {
  const old = await imageUrlsOf(entity, req.params.id);
  res.on('finish', () => {
    if (res.statusCode < 400 && old.length) removeUnusedUploads(old).catch((e) => console.error('upload cleanup:', e));
  });
  next();
});

// ---------- dashboard ----------
router.get('/stats', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_stats() AS stats');
  res.json(rows[0].stats);
}));

router.get('/activity', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await query(
    `SELECT a.id, a.entity, a.entity_id, a.action, a.details, a.created_at, u.username AS actor
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json(rows);
}));

// ---------- image upload ----------
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// ---------- categories ----------
router.get('/categories', h(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, count(s.id)::int AS service_count
       FROM categories c LEFT JOIN services s ON s.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order`
  );
  res.json(rows);
}));

const saveCategory = (id) => h(async (req, res) => {
  const b = req.body || {};
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_save_category($1,$2,$3,$4,$5,$6,$7,$8)', [
      id === null ? null : req.params.id, b.name, b.icon, b.description, b.image_url, b.image_credit, b.color || null, bool(b.is_active),
    ])).rows[0]
  );
  res.status(id === null ? 201 : 200).json(row);
});
router.post('/categories', saveCategory(null));
router.put('/categories/:id', cleansOldImages('categories'), saveCategory());

router.delete('/categories/:id', cleansOldImages('categories'), h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_category($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- services ----------
router.get('/services', h(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            t.name AS skill_name, t.icon AS skill_icon,
            (SELECT count(*) FROM products p WHERE p.service_id = s.id)::int AS product_count
       FROM services s JOIN categories c ON c.id = s.category_id
       JOIN service_types t ON t.code = s.skill_code
      WHERE ($1::int IS NULL OR s.category_id = $1)
        AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%')
      ORDER BY c.sort_order, s.sort_order, s.id`,
    [num(req.query.category), req.query.q || null]
  );
  res.json(rows);
}));

const saveService = (id) => h(async (req, res) => {
  const b = req.body || {};
  const row = await asActor(req.user.id, async (db) => {
    const saved = (await db.query('SELECT * FROM fn_save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      id === null ? null : req.params.id, num(b.category_id), b.name, b.description, b.image_url, b.image_credit,
      num(b.base_price), b.price_unit, num(b.eta_minutes), bool(b.requires_license), bool(b.is_active),
      b.skill_code || null,
    ])).rows[0];
    // daily-service options (only when the form sends them)
    if ('price_on_bill' in b || 'window_from' in b || 'is_featured' in b) {
      await db.query('CALL sp_set_service_options($1,$2,$3,$4,$5)', [
        saved.id, typeof b.price_on_bill === 'boolean' ? b.price_on_bill : null,
        num(b.window_from), num(b.window_to), typeof b.is_featured === 'boolean' ? b.is_featured : null,
      ]);
    }
    return (await db.query('SELECT * FROM services WHERE id = $1', [saved.id])).rows[0];
  });
  res.status(id === null ? 201 : 200).json(row);
});
router.post('/services', saveService(null));
router.put('/services/:id', cleansOldImages('services'), saveService());

router.patch('/services/:id/price', h(async (req, res) => {
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_set_service_price($1,$2,$3)', [req.params.id, num(req.body?.base_price), req.body?.price_unit])).rows[0]
  );
  res.json(row);
}));

// body: { skill_code } — which type of agent does this service
router.patch('/services/:id/skill', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_service_skill($1,$2)', [Number(req.params.id), req.body?.skill_code]));
  res.status(204).end();
}));

router.patch('/services/:id/active', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_service_active($1,$2)', [req.params.id, Boolean(req.body?.is_active)]));
  res.status(204).end();
}));

router.delete('/services/:id', cleansOldImages('services'), h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_service($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- products ----------
router.get('/products', h(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, s.name AS service_name, s.slug AS service_slug, s.category_id,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM products p
       JOIN services s ON s.id = p.service_id
       JOIN categories c ON c.id = s.category_id
      WHERE ($1::int IS NULL OR p.service_id = $1)
        AND ($2::int IS NULL OR s.category_id = $2)
      ORDER BY c.sort_order, s.sort_order, p.sort_order, p.id`,
    [num(req.query.service), num(req.query.category)]
  );
  res.json(rows);
}));

const saveProduct = (id) => h(async (req, res) => {
  const b = req.body || {};
  const row = await asActor(req.user.id, async (db) => {
    const saved = (await db.query('SELECT * FROM fn_save_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
      id === null ? null : req.params.id, num(b.service_id), b.name, b.brand, b.description, b.icon,
      b.image_url, b.image_credit, b.unit, num(b.price), num(b.mrp), bool(b.in_stock), bool(b.is_active),
    ])).rows[0];
    // how it is sold (kg, litre…) and the cutting options (only when the form sends them)
    if ('sell_by' in b) {
      const opts = Array.isArray(b.note_options) ? b.note_options.filter((o) => typeof o === 'string') : [];
      await db.query('CALL sp_set_product_selling($1,$2,$3)', [saved.id, b.sell_by, opts]);
    }
    return (await db.query('SELECT * FROM products WHERE id = $1', [saved.id])).rows[0];
  });
  res.status(id === null ? 201 : 200).json(row);
});
router.post('/products', saveProduct(null));
router.put('/products/:id', cleansOldImages('products'), saveProduct());

// body: { field: 'price' | 'mrp', value }
router.patch('/products/:id/price', h(async (req, res) => {
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_set_product_price($1,$2,$3)', [req.params.id, req.body?.field, num(req.body?.value)])).rows[0]
  );
  res.json(row);
}));

// body: { flag: 'in_stock' | 'is_active', value }
router.patch('/products/:id/flag', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_set_product_flag($1,$2,$3)', [req.params.id, req.body?.flag, Boolean(req.body?.value)])
  );
  res.status(204).end();
}));

router.delete('/products/:id', cleansOldImages('products'), h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_product($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- one-click image change for any row ----------
for (const entity of ['categories', 'services', 'products']) {
  router.patch(`/${entity}/:id/image`, cleansOldImages(entity), h(async (req, res) => {
    await asActor(req.user.id, (db) =>
      db.query('CALL sp_set_image($1,$2,$3,$4)', [entity, req.params.id, req.body?.image_url, req.body?.image_credit])
    );
    res.status(204).end();
  }));
}

// Pack size / quantity of a product, or price unit of a service. body: { unit }
for (const entity of ['services', 'products']) {
  router.patch(`/${entity}/:id/unit`, h(async (req, res) => {
    await asActor(req.user.id, (db) => db.query('CALL sp_set_unit($1,$2,$3)', [entity, req.params.id, req.body?.unit ?? '']));
    res.status(204).end();
  }));
}

// ---------- pricing ----------
router.post('/prices/bulk', h(async (req, res) => {
  const { categoryId, percent, roundTo, target = 'services' } = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('CALL sp_bulk_update_prices($1,$2,$3,$4,NULL)', [num(categoryId), num(percent), num(roundTo) || 1, target])
  );
  res.json({ updated: rows[0].p_updated });
}));

// Service and product price changes, newest first.
router.get('/prices/history', h(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'service' AS kind, h.id, s.name, c.icon AS category_icon, NULL AS unit,
              h.old_price, h.new_price, h.old_unit, h.new_unit, NULL::numeric AS old_mrp, NULL::numeric AS new_mrp,
              u.username AS changed_by_name, h.changed_at
         FROM service_price_history h
         JOIN services s ON s.id = h.service_id
         JOIN categories c ON c.id = s.category_id
         LEFT JOIN users u ON u.id = h.changed_by
       UNION ALL
       SELECT 'product', h.id, p.name, c.icon, p.unit,
              h.old_price, h.new_price, NULL, NULL, h.old_mrp, h.new_mrp,
              u.username, h.changed_at
         FROM product_price_history h
         JOIN products p ON p.id = h.product_id
         JOIN services s ON s.id = p.service_id
         JOIN categories c ON c.id = s.category_id
         LEFT JOIN users u ON u.id = h.changed_by
     ) x ORDER BY changed_at DESC LIMIT 150`
  );
  res.json(rows);
}));

// ---------- promotions (home page ads) ----------
router.get('/promotions', h(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, fn_promotion_state(p) AS state, ${HREF_SQL} AS href,
            CASE WHEN p.views > 0 THEN round(p.clicks * 100.0 / p.views, 1) END AS ctr
       FROM promotions p ORDER BY p.placement, p.sort_order, p.id`
  );
  res.json(rows);
}));

const savePromotion = (id) => h(async (req, res) => {
  const b = req.body || {};
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_save_promotion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [
      id === null ? null : req.params.id, b.name, b.title, b.subtitle, b.image_url, b.image_credit, b.cta_text,
      b.link_type, b.link_value, b.placement, b.bg_color || null, b.text_color || null,
      b.starts_at || null, b.ends_at || null, bool(b.is_active),
    ])).rows[0]
  );
  res.status(id === null ? 201 : 200).json(row);
});
router.post('/promotions', savePromotion(null));
router.put('/promotions/:id', cleansOldImages('promotions'), savePromotion());

router.patch('/promotions/:id/active', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_promotion_active($1,$2)', [req.params.id, Boolean(req.body?.is_active)]));
  res.status(204).end();
}));

// body: { direction: -1 | 1 }
router.post('/promotions/:id/move', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_move_promotion($1,$2)', [req.params.id, Number(req.body?.direction) < 0 ? -1 : 1]));
  res.status(204).end();
}));

router.delete('/promotions/:id', cleansOldImages('promotions'), h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_promotion($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- site settings ----------
router.put('/settings', h(async (req, res) => {
  const settings = Object.fromEntries(
    Object.entries(req.body || {}).filter(([k, v]) => /^[a-z_]{1,60}$/.test(k) && typeof v === 'string')
  );
  await asActor(req.user.id, (db) => db.query('CALL sp_save_settings($1)', [settings]));
  res.json(settings);
}));

export default router;
