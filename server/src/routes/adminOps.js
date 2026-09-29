import { Router } from 'express';
import path from 'node:path';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { loadOrder } from './orders.js';
import { DOC_DIR, DOC_FIELDS, createAgent, docUpload, parseSkills } from './agent.js';

// Admin: manage orders and delivery agents.
const router = Router();
router.use(requireAuth, requireRole('admin'));

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const num = (v) => (v === '' || v == null ? null : Number(v));

// ---------- orders ----------
router.get('/orders-stats', h(async (req, res) => {
  const { rows } = await query('SELECT fn_order_stats() AS s');
  res.json(rows[0].s);
}));

// ?status=placed|assigned|picked_up|delivered|cancelled|active  ?q=  ?agent=  ?customer=  ?date=YYYY-MM-DD
router.get('/orders', h(async (req, res) => {
  const { status, q, agent, customer, date } = req.query;
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.delivery_fee, o.created_at, o.assigned_at, o.delivered_at,
            o.contact_name, o.contact_phone, o.slot, o.agent_id, o.customer_id,
            l.name AS locality_name, cu.username AS customer_username, ag.full_name AS agent_name, ag.phone AS agent_phone,
            o.skill_code, st.name AS skill_name, st.icon AS skill_icon,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(i.name || CASE WHEN i.qty > 1 THEN ' x' || i.qty ELSE '' END, ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN users cu ON cu.id = o.customer_id
       JOIN service_types st ON st.code = o.skill_code
       LEFT JOIN users ag ON ag.id = o.agent_id
      WHERE ($1::text IS NULL OR ($1 = 'active' AND o.status IN ('placed', 'assigned', 'picked_up')) OR o.status = $1)
        AND ($2::text IS NULL OR o.id::text = ltrim($2, '#') OR o.contact_name ILIKE '%' || $2 || '%'
             OR o.contact_phone LIKE '%' || $2 || '%' OR cu.username ILIKE '%' || $2 || '%' OR l.name ILIKE '%' || $2 || '%')
        AND ($3::int IS NULL OR o.agent_id = $3)
        AND ($4::int IS NULL OR o.customer_id = $4)
        AND ($5::date IS NULL OR o.created_at::date = $5::date)
        AND ($6::text IS NULL OR o.skill_code = $6)
      ORDER BY o.created_at DESC
      LIMIT 300`,
    [status || null, q?.trim() || null, num(agent), num(customer), date || null, req.query.skill || null]
  );
  res.json(rows);
}));

router.get('/orders/:id', h(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Free/busy agents with distance to this order, to help the admin choose.
  const { rows: agents } = await query(
    `SELECT v.user_id, v.full_name, v.phone, v.state, v.vehicle_type, v.locality_name,
            CASE WHEN v.lat IS NOT NULL THEN fn_distance_km(v.lat, v.lng, $1, $2) END AS distance_km
       FROM v_agents v WHERE v.status = 'active' AND $3 = ANY (v.skills)
      ORDER BY (v.state = 'free') DESC, distance_km NULLS LAST`,
    [order.locality_lat, order.locality_lng, order.skill_code]
  );
  res.json({ ...order, candidates: agents });
}));

router.post('/orders/:id/assign', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('SELECT fn_admin_assign_order($1,$2)', [Number(req.params.id), num(req.body?.agent_id)]));
  res.status(204).end();
}));

router.post('/orders/:id/cancel', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_cancel_order($1,$2,true,$3)', [Number(req.params.id), req.user.id, req.body?.reason || null])
  );
  res.status(204).end();
}));

// ---------- customers (for the orders page) ----------
router.get('/customers/:id', h(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.created_at,
            count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered,
            coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS spent
       FROM users u LEFT JOIN orders o ON o.customer_id = u.id
      WHERE u.id = $1 GROUP BY u.id`,
    [Number(req.params.id)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
  res.json(rows[0]);
}));

// ---------- agents ----------
// ?state=free|busy|offline|pending|rejected|suspended
router.get('/agents', h(async (req, res) => {
  const { rows } = await query(
    `SELECT v.user_id, v.username, v.full_name, v.phone, v.email, v.status, v.state, v.is_online, v.vehicle_type,
            v.vehicle_number, v.locality_name, v.active_orders, v.today_deliveries, v.last_seen_at, v.created_at, v.skills,
            v.rejection_reason, (fn_agent_stats(v.user_id)->>'wallet_balance')::numeric AS wallet_balance,
            (fn_agent_stats(v.user_id)->>'cash_in_hand')::numeric AS cash_in_hand,
            (fn_agent_stats(v.user_id)->>'total_deliveries')::int AS total_deliveries
       FROM v_agents v
      WHERE ($1::text IS NULL OR v.state = $1)
        AND ($2::text IS NULL OR $2 = ANY (v.skills))
      ORDER BY array_position(ARRAY['pending','free','busy','offline','suspended','rejected'], v.state), v.full_name`,
    [req.query.state || null, req.query.skill || null]
  );
  res.json(rows);
}));

router.get('/agents/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT * FROM v_agents WHERE user_id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  const [{ rows: stats }, { rows: orders }, { rows: wallet }] = await Promise.all([
    query('SELECT fn_agent_stats($1) AS s', [id]),
    query(
      `SELECT o.id, o.status, o.total, o.agent_earning, o.created_at, o.delivered_at, o.contact_name, l.name AS locality_name,
              round(extract(epoch FROM o.delivered_at - o.assigned_at) / 60) AS minutes
         FROM orders o JOIN localities l ON l.id = o.locality_id
        WHERE o.agent_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
      [id]
    ),
    query(
      `SELECT w.*, u.username AS created_by_name FROM agent_wallet w LEFT JOIN users u ON u.id = w.created_by
        WHERE w.agent_id = $1 ORDER BY w.created_at DESC LIMIT 100`,
      [id]
    ),
  ]);
  const agent = rows[0];
  // Which documents exist (the files themselves are fetched separately).
  const docs = Object.fromEntries(DOC_FIELDS.map((f) => [f, Boolean(agent[f])]));
  DOC_FIELDS.forEach((f) => delete agent[f]);
  res.json({ agent, docs, stats: stats[0].s, orders, wallet });
}));

// Streams an identity document to an admin. Never exposed publicly.
router.get('/agents/:id/docs/:field', h(async (req, res) => {
  if (!DOC_FIELDS.includes(req.params.field)) return res.status(404).json({ error: 'Unknown document' });
  const { rows } = await query(`SELECT ${req.params.field} AS file FROM agents WHERE user_id = $1`, [Number(req.params.id)]);
  if (!rows[0]?.file) return res.status(404).json({ error: 'Document not uploaded' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(DOC_DIR, path.basename(rows[0].file)));
}));

// Admin adds an agent directly (active straight away; documents optional).
router.post('/agents', docUpload, h(async (req, res) => {
  const agent = await createAgent(req, 'active');
  res.status(201).json(agent);
}));

// body: { approve: bool, reason? }
router.post('/agents/:id/review', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_review_agent($1,$2,$3,$4)', [Number(req.params.id), Boolean(req.body?.approve), req.body?.reason || null, req.user.id])
  );
  res.status(204).end();
}));

// body: { skills: ['plumbing', 'electrical'] }
router.patch('/agents/:id/skills', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_agent_skills($1,$2)', [Number(req.params.id), parseSkills(req.body?.skills)]));
  res.status(204).end();
}));

// body: { status: 'active' | 'suspended' }
router.patch('/agents/:id/status', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_agent_status($1,$2)', [Number(req.params.id), req.body?.status]));
  res.status(204).end();
}));

// body: { type: 'payout' | 'bonus' | 'cod_deposited', amount, note }
router.post('/agents/:id/wallet', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_wallet_entry($1,$2,$3,$4,$5)', [Number(req.params.id), req.body?.type, num(req.body?.amount), req.body?.note || null, req.user.id])
  );
  res.status(204).end();
}));

// ---------- service types (which agents do which services) ----------
router.get('/service-types', h(async (req, res) => {
  const { rows } = await query('SELECT * FROM fn_service_type_overview()');
  res.json(rows);
}));

// Create (no code) or update (code in URL) a type. body: { name, agent_title, icon, is_active }
const saveType = (withCode) => h(async (req, res) => {
  const b = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_save_service_type($1,$2,$3,$4,$5)', [
      withCode ? req.params.code : null, b.name, b.agent_title, b.icon, b.is_active ?? true,
    ])
  );
  res.status(withCode ? 200 : 201).json(rows[0]);
});
router.post('/service-types', saveType(false));
router.put('/service-types/:code', saveType(true));

export default router;
