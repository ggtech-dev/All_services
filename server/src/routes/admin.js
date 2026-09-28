import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const UPLOAD_DIR = path.resolve(import.meta.dirname, '../../uploads');

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Wraps async handlers so thrown errors reach the error middleware.
const h = (fn) => (req, res, next) => fn(req, res).catch(next);

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

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const bool = (v) => (v === undefined || v === null ? null : Boolean(v));

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
router.put('/categories/:id', saveCategory());

router.delete('/categories/:id', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_category($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- services ----------
router.get('/services', h(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
       FROM services s JOIN categories c ON c.id = s.category_id
      WHERE ($1::int IS NULL OR s.category_id = $1)
        AND ($2::text IS NULL OR s.name ILIKE '%' || $2 || '%')
      ORDER BY c.sort_order, s.sort_order, s.id`,
    [num(req.query.category), req.query.q || null]
  );
  res.json(rows);
}));

const saveService = (id) => h(async (req, res) => {
  const b = req.body || {};
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
      id === null ? null : req.params.id, num(b.category_id), b.name, b.description, b.image_url, b.image_credit,
      num(b.base_price), b.price_unit, num(b.eta_minutes), bool(b.requires_license), bool(b.is_active),
    ])).rows[0]
  );
  res.status(id === null ? 201 : 200).json(row);
});
router.post('/services', saveService(null));
router.put('/services/:id', saveService());

router.patch('/services/:id/price', h(async (req, res) => {
  const row = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_set_service_price($1,$2,$3)', [req.params.id, num(req.body?.base_price), req.body?.price_unit])).rows[0]
  );
  res.json(row);
}));

router.patch('/services/:id/active', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_service_active($1,$2)', [req.params.id, Boolean(req.body?.is_active)]));
  res.status(204).end();
}));

router.delete('/services/:id', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_delete_service($1)', [req.params.id]));
  res.status(204).end();
}));

// ---------- pricing ----------
router.post('/prices/bulk', h(async (req, res) => {
  const { categoryId, percent, roundTo } = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('CALL sp_bulk_update_prices($1,$2,$3,NULL)', [num(categoryId), num(percent), num(roundTo) || 1])
  );
  res.json({ updated: rows[0].p_updated });
}));

router.get('/prices/history', h(async (req, res) => {
  const { rows } = await query(
    `SELECT h.*, s.name AS service_name, c.icon AS category_icon, u.username AS changed_by_name
       FROM service_price_history h
       JOIN services s ON s.id = h.service_id
       JOIN categories c ON c.id = s.category_id
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE ($1::int IS NULL OR h.service_id = $1)
      ORDER BY h.changed_at DESC LIMIT 100`,
    [num(req.query.service)]
  );
  res.json(rows);
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
