import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { loadOrder } from './orders.js';

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- identity documents (Aadhaar, PAN, licence, photo) ----------
// Stored outside the public uploads folder; only admins can view them through the API.
export const DOC_DIR = path.resolve(import.meta.dirname, '../../private_uploads');
mkdirSync(DOC_DIR, { recursive: true });

export const DOC_FIELDS = ['aadhaar_doc', 'pan_doc', 'dl_doc', 'photo_doc'];

export const docUpload = multer({
  storage: multer.diskStorage({
    destination: DOC_DIR,
    filename: (req, file, cb) =>
      cb(null, `${file.fieldname}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Documents must be JPG, PNG, WEBP or PDF'), { status: 400 }), ok);
  },
}).fields(DOC_FIELDS.map((name) => ({ name, maxCount: 1 })));

const removeFiles = (files) =>
  Promise.all(Object.values(files || {}).flat().map((f) => unlink(f.path).catch(() => {})));

// Creates an agent from a multipart form. status: 'pending' (public application) or 'active' (added by admin).
export async function createAgent(req, status) {
  const b = req.body || {};
  const doc = (name) => req.files?.[name]?.[0]?.filename ?? null;
  try {
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(b.username || '')) {
      throw Object.assign(new Error('Username must be 3-30 letters, numbers, _ or .'), { status: 400 });
    }
    if ((b.password || '').length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
    }
    const hash = await bcrypt.hash(b.password, 10);
    return await asActor(req.user?.id ?? null, async (db) =>
      (await db.query('SELECT * FROM fn_create_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [
        b.username, hash, b.full_name, b.phone, b.email, b.vehicle_type || 'bike', b.vehicle_number,
        b.aadhaar_number, b.pan_number, b.dl_number, b.locality_id ? Number(b.locality_id) : null,
        doc('aadhaar_doc'), doc('pan_doc'), doc('dl_doc'), doc('photo_doc'), status, req.user?.id ?? null,
      ])).rows[0]
    );
  } catch (err) {
    await removeFiles(req.files); // don't keep documents of a failed application
    if (err.code === '23505') throw Object.assign(new Error('That username is already taken'), { status: 409 });
    throw err;
  }
}

// Public: anyone can apply to become a delivery agent. An admin must approve before they can log in.
export const applyRouter = Router();
applyRouter.post('/apply', docUpload, h(async (req, res) => {
  const agent = await createAgent(req, 'pending');
  res.status(201).json({ ok: true, status: agent.status });
}));

// ---------- the agent's own app ----------
const router = Router();
router.use(requireAuth, requireRole('agent'), h(async (req, res, next) => {
  const { rows } = await query('SELECT status FROM agents WHERE user_id = $1', [req.user.id]);
  if (rows[0]?.status !== 'active') return res.status(403).json({ error: 'Your agent account is not active' });
  next();
}));

router.get('/me', h(async (req, res) => {
  const [{ rows: agent }, { rows: stats }] = await Promise.all([
    query(
      `SELECT user_id, username, full_name, phone, email, vehicle_type, vehicle_number, locality_id, locality_name,
              is_online, state, status, joined_at
         FROM v_agents WHERE user_id = $1`,
      [req.user.id]
    ),
    query("SELECT fn_agent_stats($1) || jsonb_build_object('pay_per_order', fn_setting_num('agent_pay_per_order', 25)) AS s", [req.user.id]),
  ]);
  res.json({ agent: agent[0], stats: stats[0].s });
}));

// body: { online: bool, locality_id? }
router.patch('/status', h(async (req, res) => {
  await query('CALL sp_set_agent_online($1,$2,$3)', [
    req.user.id, Boolean(req.body?.online), req.body?.locality_id ? Number(req.body.locality_id) : null,
  ]);
  res.status(204).end();
}));

// Open orders nobody has taken yet, nearest first. Customer phone/address are hidden until accepted.
router.get('/available', h(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.kind, o.total, o.slot, o.created_at, l.name AS locality_name, o.pincode,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(i.name || CASE WHEN i.qty > 1 THEN ' x' || i.qty ELSE '' END, ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary,
            CASE WHEN me.lat IS NOT NULL THEN fn_distance_km(me.lat, me.lng, l.lat, l.lng) END AS distance_km
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       LEFT JOIN (SELECT l2.lat, l2.lng FROM agents a JOIN localities l2 ON l2.id = a.locality_id WHERE a.user_id = $1) me ON true
      WHERE o.status = 'placed' AND o.agent_id IS NULL
      ORDER BY distance_km NULLS LAST, o.created_at
      LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}));

router.post('/orders/:id/accept', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('SELECT fn_agent_accept_order($1,$2)', [req.user.id, Number(req.params.id)]));
  res.json(await loadOrder(Number(req.params.id)));
}));

// scope=active (default) or history
router.get('/orders', h(async (req, res) => {
  const active = req.query.scope !== 'history';
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.agent_earning, o.created_at, o.assigned_at, o.delivered_at,
            o.contact_name, l.name AS locality_name,
            (SELECT string_agg(i.name || CASE WHEN i.qty > 1 THEN ' x' || i.qty ELSE '' END, ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o JOIN localities l ON l.id = o.locality_id
      WHERE o.agent_id = $1 AND (CASE WHEN $2 THEN o.status IN ('assigned', 'picked_up') ELSE o.status IN ('delivered', 'cancelled') END)
      ORDER BY coalesce(o.delivered_at, o.assigned_at, o.created_at) DESC
      LIMIT 200`,
    [req.user.id, active]
  );
  res.json(rows);
}));

router.get('/orders/:id', h(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order || order.agent_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  delete order.delivery_otp; // the agent must get the OTP from the customer
  res.json(order);
}));

// body: { status: 'picked_up' | 'delivered', otp? }
router.post('/orders/:id/status', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('SELECT fn_agent_update_order($1,$2,$3,$4)', [req.user.id, Number(req.params.id), req.body?.status, req.body?.otp ?? null])
  );
  res.status(204).end();
}));

router.post('/orders/:id/release', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_agent_release_order($1,$2,$3)', [req.user.id, Number(req.params.id), req.body?.reason || null])
  );
  res.status(204).end();
}));

router.get('/wallet', h(async (req, res) => {
  const [{ rows: stats }, { rows: entries }] = await Promise.all([
    query('SELECT fn_agent_stats($1) AS s', [req.user.id]),
    query(
      `SELECT id, type, amount, order_id, note, created_at FROM agent_wallet
        WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.user.id]
    ),
  ]);
  res.json({ stats: stats[0].s, entries });
}));

export default router;
