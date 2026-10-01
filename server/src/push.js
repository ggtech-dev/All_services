import { Router } from 'express';
import webpush from 'web-push';
import { query } from './db.js';
import { requireAuth } from './middleware/auth.js';

// Phone notifications (Web Push — free, no Firebase account). Agents get "New order" alerts even when the app is
// in the background or closed; customers get order updates. The VAPID key pair is made once and kept in
// app_secrets (never sent to browsers except the public key).
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const { rows } = await query("SELECT key, value FROM app_secrets WHERE key IN ('vapid_public', 'vapid_private')");
      let keys = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (!keys.vapid_public || !keys.vapid_private) {
        const k = webpush.generateVAPIDKeys();
        await query(
          `INSERT INTO app_secrets (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2)
           ON CONFLICT (key) DO NOTHING`,
          [k.publicKey, k.privateKey]
        );
        const again = await query("SELECT key, value FROM app_secrets WHERE key IN ('vapid_public', 'vapid_private')");
        keys = Object.fromEntries(again.rows.map((r) => [r.key, r.value]));
      }
      const mail = (await query("SELECT value FROM site_settings WHERE key = 'support_email'")).rows[0]?.value;
      webpush.setVapidDetails(`mailto:${mail || 'admin@allservices.local'}`, keys.vapid_public, keys.vapid_private);
      return keys.vapid_public;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Sends to every device of these users. Dead subscriptions (uninstalled app, blocked) are removed.
export async function pushTo(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  await init();
  const { rows } = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY ($1::int[])', [ids]);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 600, urgency: 'high' });
      sent++;
      await query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [s.id]);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      else console.warn('push failed:', err.statusCode || err.message);
    }
  }));
  return sent;
}

// Never let a notification problem break an order: run in the background and only log errors.
const quietly = (fn) => (...args) => {
  fn(...args).catch((err) => console.warn('notification skipped:', err.message));
};

const orderLine = async (orderId) => {
  const { rows } = await query(
    `SELECT o.id, o.total, l.name AS area, st.name AS skill_name,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o JOIN localities l ON l.id = o.locality_id JOIN service_types st ON st.code = o.skill_code WHERE o.id = $1`,
    [orderId]
  );
  return rows[0];
};
const short = (s, n = 90) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

// New order → every online agent who can take it.
export const notifyNewOrder = quietly(async (orderId) => {
  const { rows } = await query('SELECT fn_agents_to_alert($1) AS id', [orderId]);
  if (!rows.length) return;
  const o = await orderLine(orderId);
  await pushTo(rows.map((r) => r.id), {
    title: `🔔 New order #${o.id} · ${o.area}`,
    body: short(o.summary),
    url: '/agent',
    tag: `order-${o.id}`,
    kind: 'new_order',
  });
});

// Admin assigned an order to an agent.
export const notifyAssigned = quietly(async (orderId, agentId) => {
  const o = await orderLine(orderId);
  await pushTo([agentId], { title: `📦 Order #${o.id} assigned to you`, body: `${o.area} · ${short(o.summary)}`, url: '/agent', tag: `order-${o.id}`, kind: 'assigned' });
});

// Customer updates.
const CUSTOMER_TEXT = {
  assigned: (o) => [`✅ Order #${o.id} accepted`, `${o.agent_name || 'Your partner'} is on it.`],
  picked_up: (o) => [`🛵 Order #${o.id} is on the way`, `${o.agent_name || 'Your partner'} has picked it up.`],
  delivered: (o) => [`🎉 Order #${o.id} delivered`, 'Thank you! Tap to rate your experience.'],
  cancelled: (o) => [`Order #${o.id} cancelled`, 'Tap to see details.'],
};
export const notifyCustomer = quietly(async (orderId, status) => {
  const make = CUSTOMER_TEXT[status];
  if (!make) return;
  const { rows } = await query(
    'SELECT o.id, o.customer_id, u.full_name AS agent_name FROM orders o LEFT JOIN users u ON u.id = o.agent_id WHERE o.id = $1',
    [orderId]
  );
  if (!rows[0]) return;
  const [title, body] = make(rows[0]);
  await pushTo([rows[0].customer_id], { title, body, url: `/orders/${orderId}`, tag: `order-${orderId}`, kind: status });
});

// ---------- routes: /api/push ----------
export const pushRouter = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

pushRouter.get('/key', h(async (req, res) => {
  res.json({ key: await init() });
}));

pushRouter.post('/subscribe', requireAuth, h(async (req, res) => {
  const s = req.body?.subscription;
  const ok = s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
  if (!ok) return res.status(400).json({ error: 'Invalid notification subscription' });
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                                          user_agent = EXCLUDED.user_agent`,
    [req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth, String(req.get('user-agent') || '').slice(0, 200)]
  );
  res.status(204).end();
}));

pushRouter.post('/unsubscribe', requireAuth, h(async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, endpoint]);
  res.status(204).end();
}));

// "Send a test notification" button.
pushRouter.post('/test', requireAuth, h(async (req, res) => {
  const sent = await pushTo([req.user.id], { title: '🔔 Alerts are on', body: 'You will get a notification like this for every new order.', url: req.user.role === 'agent' ? '/agent' : '/', tag: 'test', kind: 'test' });
  res.json({ sent });
}));
