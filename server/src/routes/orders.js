import { Router } from 'express';
import { query, asActor } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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
            s.name AS service_name,
            (SELECT c.icon FROM order_items i
               LEFT JOIN products p ON p.id = i.product_id
               LEFT JOIN services s2 ON s2.id = coalesce(i.service_id, p.service_id)
               LEFT JOIN categories c ON c.id = s2.category_id
              WHERE i.order_id = o.id LIMIT 1) AS icon
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN users cu ON cu.id = o.customer_id
       LEFT JOIN agents a ON a.user_id = o.agent_id
       LEFT JOIN users ag ON ag.id = o.agent_id
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
  return { ...rows[0], items: items.rows, events: events.rows };
}

// Delivery fee the customer will pay on their next product order.
router.get('/quote', h(async (req, res) => {
  const { rows } = await query(
    `SELECT fn_delivery_fee_for($1) AS delivery_fee,
            greatest(0, fn_setting_num('free_delivery_orders', 3)
              - (SELECT count(*) FROM orders WHERE customer_id = $1 AND status <> 'cancelled'))::int AS free_left`,
    [req.user.id]
  );
  res.json({ delivery_fee: Number(rows[0].delivery_fee), free_left: rows[0].free_left });
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

router.post('/', h(async (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items.map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) })) : null;
  const order = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_place_order($1,$2,$3,$4,$5,$6)', [
      req.user.id, items ? JSON.stringify(items) : null, b.service_id ? Number(b.service_id) : null,
      JSON.stringify(b.contact || {}), b.slot || null, b.notes || null,
    ])).rows[0]
  );
  res.status(201).json(order);
}));

router.get('/', h(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.created_at, o.delivered_at, o.delivery_otp,
            ag.full_name AS agent_name,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(i.name || CASE WHEN i.qty > 1 THEN ' x' || i.qty ELSE '' END, ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o LEFT JOIN users ag ON ag.id = o.agent_id
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

router.post('/:id/cancel', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_cancel_order($1,$2,false,$3)', [Number(req.params.id), req.user.id, req.body?.reason || null])
  );
  res.status(204).end();
}));

export default router;
