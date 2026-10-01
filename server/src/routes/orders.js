import { Router } from 'express';
import { query, asActor } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { clearShopPaymentDetails, discardUploads, orderPhotoUpload, removeOrderFiles, sendOrderFile, uploadedName, withPhotoFlags } from '../orderFiles.js';
import { notifyNewOrder } from '../push.js';

// Customer orders: place, list, track, cancel.
const router = Router();
router.use(requireAuth);

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Everything the tracking page needs for one order.
export async function loadOrder(id, { customerId } = {}) {
  const { rows } = await query(
    `SELECT o.*, l.name AS locality_name, l.lat AS locality_lat, l.lng AS locality_lng,
            cu.full_name AS customer_name, cu.username AS customer_username, cu.phone AS customer_phone,
            ag.full_name AS agent_name, ag.phone AS agent_phone, a.vehicle_type, a.vehicle_number,
            coalesce(sh.name, o.preferred_shop_name) AS preferred_shop, sh.phone AS preferred_shop_phone, shl.name AS preferred_shop_area,
            (fn_setting_num('require_delivery_otp', 0) = 1) AS otp_required,
            (SELECT to_jsonb(r) - 'customer_id' FROM order_ratings r WHERE r.order_id = o.id) AS rating,
            s.name AS service_name, st.name AS skill_name, st.agent_title, st.icon AS skill_icon,
            (SELECT c.icon FROM order_items i
               LEFT JOIN products p ON p.id = i.product_id
               LEFT JOIN services s2 ON s2.id = coalesce(i.service_id, p.service_id)
               LEFT JOIN categories c ON c.id = s2.category_id
              WHERE i.order_id = o.id LIMIT 1) AS icon
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN users cu ON cu.id = o.customer_id
       JOIN service_types st ON st.code = o.skill_code
       LEFT JOIN agents a ON a.user_id = o.agent_id
       LEFT JOIN users ag ON ag.id = o.agent_id
       LEFT JOIN shops sh ON sh.id = o.preferred_shop_id
       LEFT JOIN localities shl ON shl.id = sh.locality_id
       LEFT JOIN LATERAL (SELECT s.name FROM order_items i JOIN services s ON s.id = i.service_id
                           WHERE i.order_id = o.id LIMIT 1) s ON true
      WHERE o.id = $1 AND ($2::int IS NULL OR o.customer_id = $2)`,
    [id, customerId ?? null]
  );
  if (!rows[0]) return null;
  const [items, events] = await Promise.all([
    query(
      `SELECT i.*, p.icon, p.image_url FROM order_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1 ORDER BY i.id`,
      [id]
    ),
    query(
      `SELECT e.status, e.note, e.created_at, u.full_name AS actor_name, u.role AS actor_role
         FROM order_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.order_id = $1 ORDER BY e.created_at, e.id`,
      [id]
    ),
  ]);
  return withPhotoFlags({ ...rows[0], items: items.rows, events: events.rows });
}

// Delivery charge for the checkout: ?products=12,15,40 (cart) or ?service=7 (booking);
// &lists=19 = services the customer wrote their own list for (kirana…).
router.get('/quote', h(async (req, res) => {
  const products = String(req.query.products || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, 40).map(Number);
  const lists = String(req.query.lists || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, 40).map(Number);
  const service = /^\d{1,9}$/.test(String(req.query.service || '')) ? Number(req.query.service) : null;
  const { rows } = await query('SELECT fn_delivery_quote($1,$2,$3,$4) AS q', [req.user.id, products, service, lists]);
  const q = rows[0].q;
  // + shop-bill items, and the delivery time window with the slots the customer can pick
  res.json({ ...q, delivery_fee: Number(q.delivery_fee), base_fee: Number(q.base_fee) });
}));

// Last address used, to pre-fill checkout.
router.get('/last-address', h(async (req, res) => {
  const { rows } = await query(
    `SELECT contact_name, contact_phone, address_line, landmark, locality_id, pincode
       FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json(rows[0] || null);
}));

// JSON, or multipart with the order in "data" and an optional "list_photo" (photo of a handwritten list).
router.post('/', orderPhotoUpload(['list_photo']), h(async (req, res) => {
  let b = req.body || {};
  try {
    if (typeof b.data === 'string') b = JSON.parse(b.data);
  } catch {
    await discardUploads(req);
    return res.status(400).json({ error: 'Invalid request' });
  }
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  // products: qty can be 1.5 (kg), note = cutting instructions · own list: { service_id, name, qty_text }
  const items = Array.isArray(b.items)
    ? b.items.map((i) => (i && i.product_id != null
      ? { product_id: Number(i.product_id), qty: Number(i.qty), note: text(i.note, 200) }
      : { service_id: Number(i?.service_id), name: text(i?.name, 120), qty_text: text(i?.qty_text, 60), note: text(i?.note, 200) }))
    : null;
  try {
    const order = await asActor(req.user.id, async (db) =>
      (await db.query('SELECT * FROM fn_place_order($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        req.user.id, items ? JSON.stringify(items) : null, b.service_id ? Number(b.service_id) : null,
        JSON.stringify(b.contact || {}), b.slot || null, b.notes || null,
        uploadedName(req, 'list_photo'), /^\d{1,9}$/.test(String(b.shop_id ?? '')) ? Number(b.shop_id) : null, text(b.shop_name, 120) || null,
      ])).rows[0]
    );
    res.status(201).json(withPhotoFlags(order));
    notifyNewOrder(order.id); // phone alert to agents who can take it
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
}));

router.get('/', h(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.created_at, o.delivered_at, o.delivery_otp,
            ag.full_name AS agent_name, st.agent_title, (fn_setting_num('require_delivery_otp', 0) = 1) AS otp_required,
            (SELECT r.stars FROM order_ratings r WHERE r.order_id = o.id) AS rated,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o LEFT JOIN users ag ON ag.id = o.agent_id
       JOIN service_types st ON st.code = o.skill_code
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
}));

router.get('/:id', h(async (req, res) => {
  const order = await loadOrder(Number(req.params.id), { customerId: req.user.id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
}));

// Customer rates the agent after delivery. body: { stars: 1-5, comment?, tags?: [] }
router.post('/:id/rating', h(async (req, res) => {
  const b = req.body || {};
  const tags = Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === 'string').slice(0, 10) : [];
  await query('CALL sp_rate_order($1,$2,$3,$4,$5)', [
    req.user.id, Number(req.params.id), Number.isInteger(b.stars) ? b.stars : null, typeof b.comment === 'string' ? b.comment : null, tags,
  ]);
  res.json((await loadOrder(Number(req.params.id), { customerId: req.user.id })).rating);
}));

// Live position of the agent on the customer's own order — only while it is assigned / on the way.
export const LIVE_SQL = `SELECT o.id, o.status, o.agent_id,
            coalesce(o.dest_lat, l.lat)::float AS dest_lat, coalesce(o.dest_lng, l.lng)::float AS dest_lng,
            (o.dest_lat IS NOT NULL) AS exact_pin,
            a.last_lat::float AS agent_lat, a.last_lng::float AS agent_lng, a.last_accuracy_m AS accuracy_m,
            a.last_location_at,
            extract(epoch FROM now() - a.last_location_at)::int AS age_seconds,
            fn_distance_km(a.last_lat, a.last_lng, coalesce(o.dest_lat, l.lat), coalesce(o.dest_lng, l.lng))::float AS distance_km,
            fn_eta_minutes(fn_distance_km(a.last_lat, a.last_lng, coalesce(o.dest_lat, l.lat), coalesce(o.dest_lng, l.lng))) AS eta_minutes
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       LEFT JOIN agents a ON a.user_id = o.agent_id`;
export const TRAIL_SQL = `SELECT lat::float, lng::float, recorded_at FROM agent_location_trail
      WHERE order_id = $1 ORDER BY recorded_at LIMIT 500`;

router.get('/:id/live', h(async (req, res) => {
  const { rows } = await query(`${LIVE_SQL} WHERE o.id = $1 AND o.customer_id = $2`, [Number(req.params.id), req.user.id]);
  const live = rows[0];
  if (!live) return res.status(404).json({ error: 'Order not found' });
  if (!['assigned', 'picked_up'].includes(live.status) || live.agent_lat == null) {
    // Nothing to show (not yet assigned, finished, or agent location unknown): send the destination only.
    return res.json({ status: live.status, dest: { lat: live.dest_lat, lng: live.dest_lng }, agent: null });
  }
  const trail = live.status === 'picked_up' ? (await query(TRAIL_SQL, [live.id])).rows : [];
  res.json({
    status: live.status,
    dest: { lat: live.dest_lat, lng: live.dest_lng, exact: live.exact_pin },
    agent: { lat: live.agent_lat, lng: live.agent_lng, accuracy_m: live.accuracy_m, age_seconds: live.age_seconds },
    distance_km: live.distance_km,
    eta_minutes: live.eta_minutes,
    trail,
  });
}));

router.post('/:id/cancel', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_cancel_order($1,$2,false,$3)', [Number(req.params.id), req.user.id, req.body?.reason || null])
  );
  await clearShopPaymentDetails(Number(req.params.id));
  res.status(204).end();
}));

// Customer uploads the screenshot of paying the shop by UPI. multipart: payment_photo, ref (optional)
router.post('/:id/payment-proof', orderPhotoUpload(['payment_photo']), h(async (req, res) => {
  try {
    const { rows } = await asActor(req.user.id, (db) =>
      db.query('SELECT fn_customer_payment_proof($1,$2,$3,$4) AS old', [
        req.user.id, Number(req.params.id), uploadedName(req, 'payment_photo'), req.body?.ref || null,
      ])
    );
    await removeOrderFiles([rows[0].old]);
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
  res.status(204).end();
}));

// Bill / shop QR / payment screenshot of the customer's own order.
router.get('/:id/files/:kind', h(async (req, res) => {
  await sendOrderFile(res, Number(req.params.id), req.params.kind, 'customer_id = $2', [req.user.id]);
}));

export default router;
