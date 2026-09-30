import { Router } from 'express';
import path from 'node:path';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { LIVE_SQL, TRAIL_SQL, loadOrder } from './orders.js';
import { DOC_DIR, DOC_FIELDS, createAgent, docUpload, parseSkills } from './agent.js';
import { clearShopPaymentDetails, sendOrderFile } from '../orderFiles.js';

// Admin: manage orders and delivery agents.
const router = Router();
router.use(requireAuth, requireRole('admin'));

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
// '' / missing → null; anything that is not a real number (e.g. "abc" → NaN) is a 400, never stored.
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Enter a valid number'), { status: 400 });
  return n;
};

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
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by), ', ' ORDER BY i.id)
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
  await clearShopPaymentDetails(Number(req.params.id));
  res.status(204).end();
}));

router.get('/orders/:id/files/:kind', h(async (req, res) => {
  await sendOrderFile(res, Number(req.params.id), req.params.kind);
}));

// Live position of an order's agent (for the order detail map).
router.get('/orders/:id/live', h(async (req, res) => {
  const { rows } = await query(`${LIVE_SQL} WHERE o.id = $1`, [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
  const trail = (await query(TRAIL_SQL, [rows[0].id])).rows;
  res.json({ ...rows[0], trail });
}));

// ---------- live map: every active agent with a known position ----------
router.get('/live', h(async (req, res) => {
  const { rows } = await query(
    `SELECT v.user_id, v.full_name, v.phone, v.state, v.skills, v.vehicle_type, v.vehicle_number, v.locality_name,
            v.last_lat::float AS lat, v.last_lng::float AS lng, v.last_accuracy_m AS accuracy_m, v.last_location_at,
            extract(epoch FROM now() - v.last_location_at)::int AS age_seconds,
            o.id AS order_id, o.status AS order_status, o.contact_name, ol.name AS order_locality,
            coalesce(o.dest_lat, ol.lat)::float AS dest_lat, coalesce(o.dest_lng, ol.lng)::float AS dest_lng
       FROM v_agents v
       LEFT JOIN LATERAL (SELECT * FROM orders o WHERE o.agent_id = v.user_id AND o.status IN ('assigned', 'picked_up')
                           ORDER BY o.assigned_at DESC LIMIT 1) o ON true
       LEFT JOIN localities ol ON ol.id = o.locality_id
      WHERE v.status = 'active' AND v.last_lat IS NOT NULL
      ORDER BY v.last_location_at DESC`
  );
  res.json(rows);
}));

// One agent's movement today (or ?hours=N, max 72) plus their current order, for the tracking panel.
router.get('/agents/:id/track', h(async (req, res) => {
  const id = Number(req.params.id);
  const hours = Math.min(Math.max(Number(req.query.hours) || 12, 1), 72);
  const [{ rows: trail }, { rows: order }] = await Promise.all([
    query(
      `SELECT lat::float, lng::float, order_id, recorded_at FROM agent_location_trail
        WHERE agent_id = $1 AND recorded_at > now() - make_interval(hours => $2)
        ORDER BY recorded_at LIMIT 2000`,
      [id, hours]
    ),
    query(
      `${LIVE_SQL} WHERE o.agent_id = $1 AND o.status IN ('assigned', 'picked_up') ORDER BY o.assigned_at DESC LIMIT 1`,
      [id]
    ),
  ]);
  res.json({ trail, order: order[0] || null });
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

// ---------- reports ----------
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (India dates, inclusive)
router.get('/reports', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const { rows } = await query('SELECT fn_report($1::date, $2::date) AS r', [from, to]);
  res.json(rows[0].r);
}));

// Every order in the range as a CSV file (opens in Excel / Google Sheets).
router.get('/reports/orders.csv', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const { rows } = await query(
    `SELECT o.id AS "Order", to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "Placed (IST)",
            o.status AS "Status", st.name AS "Agent type", o.contact_name AS "Customer", o.contact_phone AS "Phone",
            l.name AS "Area", o.pincode AS "Pincode",
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by) || coalesce(' (' || i.note || ')', ''), '; ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS "Items",
            o.subtotal AS "Items total", o.delivery_fee AS "Delivery fee", o.total AS "Total",
            ag.full_name AS "Agent", ag.phone AS "Agent phone",
            to_char(o.delivered_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "Delivered (IST)",
            round(extract(epoch FROM o.delivered_at - o.created_at) / 60) AS "Minutes to deliver",
            o.agent_earning AS "Agent pay", o.cancel_reason AS "Cancel reason"
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN service_types st ON st.code = o.skill_code
       LEFT JOIN users ag ON ag.id = o.agent_id
      WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      ORDER BY o.id`,
    [from, to]
  );
  const cols = rows.length ? Object.keys(rows[0]) : ['Order'];
  // Quote every cell; neutralise values starting with = + - @ so spreadsheets don't run them as formulas.
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="orders_${from}_to_${to}.csv"`);
  res.send('﻿' + csv); // BOM so Excel shows ₹ and Telugu names correctly
}));

// ---------- delivery charges (per service) ----------
router.get('/delivery-charges', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_delivery_charges() AS list');
  res.json(rows[0].list);
}));

// body: { fee }
router.patch('/services/:id/delivery-fee', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_service_delivery_fee($1,$2)', [Number(req.params.id), num(req.body?.fee)]));
  res.status(204).end();
}));

// Same charge for a whole category. body: { category_id, fee }
router.post('/delivery-charges/category', h(async (req, res) => {
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT fn_set_category_delivery_fee($1,$2) AS n', [num(req.body?.category_id), num(req.body?.fee)])
  );
  res.json({ updated: rows[0].n });
}));

// ---------- service areas ----------
router.get('/localities', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_localities() AS list');
  res.json(rows[0].list);
}));

// Create (no id) or update an area. body: { name, pincode, lat, lng, is_active }
const saveLocality = (withId) => h(async (req, res) => {
  const b = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_save_locality($1,$2,$3,$4,$5,$6)', [
      withId ? Number(req.params.id) : null, typeof b.name === 'string' ? b.name : null,
      typeof b.pincode === 'string' ? b.pincode : null, num(b.lat), num(b.lng),
      typeof b.is_active === 'boolean' ? b.is_active : null,
    ])
  );
  res.status(withId ? 200 : 201).json(rows[0]);
});
router.post('/localities', saveLocality(false));
router.put('/localities/:id', saveLocality(true));

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
