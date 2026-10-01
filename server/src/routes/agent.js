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
import { clearShopPaymentDetails, discardUploads, orderPhotoUpload, removeOrderFiles, sendOrderFile, uploadedName } from '../orderFiles.js';

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

// Skills arrive from forms as repeated fields, a comma list or an array: always return an array.
export const parseSkills = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

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
      (await db.query('SELECT * FROM fn_create_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)', [
        b.username, hash, b.full_name, b.phone, b.email, b.vehicle_type || 'bike', b.vehicle_number,
        b.aadhaar_number, b.pan_number, b.dl_number, b.locality_id ? Number(b.locality_id) : null,
        doc('aadhaar_doc'), doc('pan_doc'), doc('dl_doc'), doc('photo_doc'), status, req.user?.id ?? null,
        parseSkills(b.skills),
      ])).rows[0]
    );
  } catch (err) {
    await removeFiles(req.files); // don't keep documents of a failed application
    if (err.code === '23505') {
      const msg = err.constraint === 'users_email_unique' ? 'An account with this email already exists' : 'That username is already taken';
      throw Object.assign(new Error(msg), { status: 409 });
    }
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
      `SELECT v.user_id, v.username, v.full_name, v.phone, v.email, v.vehicle_type, v.vehicle_number, v.locality_id,
              v.locality_name, v.is_online, v.state, v.status, v.joined_at, v.skills,
              (SELECT json_agg(json_build_object('code', t.code, 'name', t.name, 'icon', t.icon) ORDER BY t.sort_order)
                 FROM service_types t WHERE t.code = ANY (v.skills)) AS skill_list
         FROM v_agents v WHERE v.user_id = $1`,
      [req.user.id]
    ),
    query("SELECT fn_agent_stats($1) || jsonb_build_object('pay_per_order', fn_setting_num('agent_pay_per_order', 25)) AS s", [req.user.id]),
  ]);
  res.json({ agent: agent[0], stats: stats[0].s });
}));

// body: { lat, lng, accuracy } — sent every ~10 s by the agent app while online.
router.post('/location', h(async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  const { rows } = await query('SELECT fn_agent_location($1,$2,$3,$4) AS stored', [
    req.user.id, Number(lat), Number(lng), accuracy == null ? null : Math.round(Number(accuracy)),
  ]);
  res.json({ stored: rows[0].stored });
}));

// body: { online: bool, locality_id? }
router.patch('/status', h(async (req, res) => {
  await query('CALL sp_set_agent_online($1,$2,$3)', [
    req.user.id, req.body?.online === true || req.body?.online === 'true', req.body?.locality_id ? Number(req.body.locality_id) : null,
  ]);
  res.status(204).end();
}));

// Open orders nobody has taken yet, nearest first. Customer phone/address are hidden until accepted.
router.get('/available', h(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.kind, o.total, o.delivery_fee, o.slot, o.created_at, l.name AS locality_name, o.pincode,
            EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.on_bill) AS on_bill,
            (SELECT coalesce(sh.name, o.preferred_shop_name) FROM (SELECT 1) x LEFT JOIN shops sh ON sh.id = o.preferred_shop_id) AS preferred_shop,
            (o.list_photo IS NOT NULL) AS has_list_photo,
            st.name AS skill_name, st.icon AS skill_icon,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary,
            CASE WHEN me.lat IS NOT NULL
                 THEN fn_distance_km(me.lat, me.lng, coalesce(o.dest_lat, l.lat), coalesce(o.dest_lng, l.lng)) END AS distance_km
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN service_types st ON st.code = o.skill_code
       -- where the agent is: live GPS if under 10 minutes old, otherwise the centre of their chosen area
       LEFT JOIN (SELECT CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lat ELSE l2.lat END AS lat,
                         CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lng ELSE l2.lng END AS lng
                    FROM agents a LEFT JOIN localities l2 ON l2.id = a.locality_id WHERE a.user_id = $1) me ON true
      WHERE o.status = 'placed' AND o.agent_id IS NULL
        AND o.skill_code = ANY ((SELECT skills FROM agents WHERE user_id = $1)::text[])
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
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
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
  if (req.body?.status === 'delivered') await clearShopPaymentDetails(Number(req.params.id));
  res.status(204).end();
}));

// At the shop: bill photo + amount, and how the shop gets paid.
// multipart: amount, shop_name, mode ('customer_upi' | 'agent_cash'), upi_id, bill_photo (file), qr_photo (file)
router.post('/orders/:id/bill', orderPhotoUpload(['bill_photo', 'qr_photo']), h(async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await asActor(req.user.id, (db) =>
      db.query('SELECT * FROM fn_agent_upload_bill($1,$2,$3,$4,$5,$6,$7,$8)', [
        req.user.id, Number(req.params.id), b.amount === '' || b.amount == null ? null : Number(b.amount), b.shop_name || null,
        b.mode, b.upi_id || null, uploadedName(req, 'bill_photo'), uploadedName(req, 'qr_photo'),
      ])
    );
    await removeOrderFiles([rows[0]?.old_bill_photo, rows[0]?.old_qr_photo]);
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
  res.status(204).end();
}));

// At the door: the customer paid the delivery charge. body: { mode: 'company_upi' | 'cash' }
router.post('/orders/:id/fee-received', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_agent_fee_received($1,$2,$3)', [req.user.id, Number(req.params.id), req.body?.mode ?? null]));
  res.status(204).end();
}));

// The shopkeeper has received the customer's UPI payment.
router.post('/orders/:id/confirm-payment', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_agent_confirm_payment($1,$2)', [req.user.id, Number(req.params.id)]));
  res.status(204).end();
}));

router.get('/orders/:id/files/:kind', h(async (req, res) => {
  await sendOrderFile(res, Number(req.params.id), req.params.kind, 'agent_id = $2', [req.user.id]);
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
