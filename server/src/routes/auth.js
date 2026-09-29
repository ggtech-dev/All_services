import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { TEST_MODE, sendOtpEmail } from '../mailer.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const publicUser = (u) => ({
  id: u.id, username: u.username, fullName: u.full_name, phone: u.phone, role: u.role,
  email: u.email, emailVerified: Boolean(u.email_verified_at),
});

const signToken = (u) =>
  jwt.sign({ id: u.id, username: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const ipOf = (req) => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 64);
const log = (userId, email, event, detail, ip) =>
  query('CALL sp_auth_log($1,$2,$3,$4,$5)', [userId, email, event, detail, ip]).catch((e) => console.error('auth log:', e.message));

const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 100;
const PASSWORD_RULE = 'Password must be 6–100 characters';

// ---------- OTP codes ----------
const OTP_MINUTES = 10;
// Only a keyed hash of the code is stored, bound to the email and purpose.
const hashCode = (email, purpose, code) =>
  crypto.createHash('sha256').update(`${email.trim().toLowerCase()}|${purpose}|${code}|${process.env.JWT_SECRET}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const OTP_ERRORS = {
  no_code: 'That code is not valid. Please ask for a new one.',
  expired: 'That code has expired. Please ask for a new one.',
  locked: 'Too many wrong attempts. Please ask for a new code.',
};

async function checkCode(email, purpose, code, ip) {
  if (!/^\d{6}$/.test(String(code || '').trim())) throw Object.assign(new Error('Enter the 6-digit code from your email'), { status: 400 });
  const { rows } = await query('SELECT * FROM fn_otp_check($1,$2,$3,$4)', [email, purpose, hashCode(email, purpose, String(code).trim()), ip]);
  const r = rows[0];
  if (r.status === 'ok') return r.user_id;
  const message = r.status === 'wrong'
    ? `Wrong code. ${r.attempts_left} attempt${r.attempts_left === 1 ? '' : 's'} left.`
    : OTP_ERRORS[r.status];
  throw Object.assign(new Error(message), { status: 400 });
}

// Sends a code by email. In test mode the code is printed in the server terminal, and outside production
// it is also returned as `devCode` so the login screen can show it while testing.
async function issueCode({ email, purpose, userId = null, ip }) {
  const code = newCode();
  const { rows } = await query('SELECT * FROM fn_otp_request($1,$2,$3,$4,$5,$6)', [
    email, purpose, hashCode(email, purpose, code), userId, ip, OTP_MINUTES,
  ]);
  const target = rows[0];
  if (Math.random() < 0.02) query('CALL sp_auth_cleanup()').catch(() => {}); // occasional housekeeping
  if (target.user_id) {
    await sendOtpEmail({ to: email.trim(), name: target.full_name, code, purpose, minutes: OTP_MINUTES });
  }
  return TEST_MODE && process.env.NODE_ENV !== 'production' && target.user_id ? code : undefined;
}

// ---------- which portal may this account use ----------
// portal: 'user' | 'agent' | 'admin' — the tab chosen on the login page. Returns an error message or null.
async function portalError(user, portal) {
  if (portal === 'admin' && user.role !== 'admin') return 'This account does not have admin access. Please use the User login.';
  if (portal === 'agent') {
    if (user.role !== 'agent') return 'This is not a delivery agent account.';
    const { rows: a } = await query('SELECT status, rejection_reason FROM agents WHERE user_id = $1', [user.id]);
    const messages = {
      pending: 'Your application is under review. You can log in once the admin approves it.',
      rejected: `Your application was not approved: ${a[0]?.rejection_reason || 'please contact support'}.`,
      suspended: 'Your agent account is suspended. Please contact the admin.',
    };
    if (messages[a[0]?.status]) return messages[a[0].status];
  }
  if (portal !== 'agent' && user.role === 'agent') return 'Delivery agents please use the Agent login.';
  return null;
}

// ---------- register / password login ----------
router.post('/register', h(async (req, res) => {
  const { username, password, fullName, phone, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ error: 'Username, email and password are required' });
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-30 letters, numbers, _ or .' });
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, phone, email)
       VALUES (lower($1), $2, $3, $4, lower(trim($5))) RETURNING *`,
      [username, hash, fullName || null, phone || null, email]
    );
    log(rows[0].id, email, 'registered', null, ipOf(req));
    res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      const msg = err.constraint === 'users_email_unique' ? 'An account with this email already exists. Try logging in with an email code.' : 'That username is already taken';
      return res.status(409).json({ error: msg });
    }
    throw err;
  }
}));

// Password login with username or email.
router.post('/login', h(async (req, res) => {
  const { username, password, portal = 'user' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const id = username.trim().toLowerCase();

  const { rows } = await query('SELECT * FROM users WHERE username = $1 OR lower(email) = $1 LIMIT 1', [id]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    log(user?.id ?? null, user?.email ?? (id.includes('@') ? id : null), 'login_failed', `password (${portal})`, ipOf(req));
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const blocked = await portalError(user, portal);
  if (blocked) return res.status(403).json({ error: blocked });
  log(user.id, user.email, 'login', `password (${portal})`, ipOf(req));
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// ---------- email OTP login ----------
// body: { email, portal }. Always answers the same way whether or not the email is registered.
router.post('/otp/request', h(async (req, res) => {
  const { email, portal = 'user' } = req.body || {};
  if (portal === 'admin') return res.status(400).json({ error: 'Admins log in with their password' });
  const devCode = await issueCode({ email: email || '', purpose: 'login', ip: ipOf(req) });
  res.json({ sent: true, message: 'If this email is registered, a 6-digit code is on its way.', minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code, portal }
router.post('/otp/login', h(async (req, res) => {
  const { email, code, portal = 'user' } = req.body || {};
  if (portal === 'admin') return res.status(400).json({ error: 'Admins log in with their password' });
  const userId = await checkCode(email || '', 'login', code, ipOf(req));
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const blocked = await portalError(rows[0], portal);
  if (blocked) return res.status(403).json({ error: blocked });
  log(userId, email, 'login', `email code (${portal})`, ipOf(req));
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

// ---------- forgot password ----------
// body: { email }
router.post('/password/forgot', h(async (req, res) => {
  const devCode = await issueCode({ email: req.body?.email || '', purpose: 'reset', ip: ipOf(req) });
  res.json({ sent: true, message: 'If this email is registered, a 6-digit code is on its way.', minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code, password }
router.post('/password/reset', h(async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const userId = await checkCode(email || '', 'reset', code, ipOf(req));
  await query('CALL sp_set_password($1,$2,$3,$4)', [userId, await bcrypt.hash(password, 10), 'forgot password (email code)', ipOf(req)]);
  res.json({ ok: true, message: 'Password changed. You can log in with your new password.' });
}));

// ---------- logged-in account ----------
router.get('/me', requireAuth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
}));

// body: { current, password }
router.post('/password/change', requireAuth, h(async (req, res) => {
  const { current, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const { rows } = await query('SELECT password_hash, email FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(current || '', rows[0].password_hash))) {
    log(req.user.id, rows[0]?.email, 'password_change_failed', 'wrong current password', ipOf(req));
    return res.status(400).json({ error: 'Your current password is not correct' });
  }
  await query('CALL sp_set_password($1,$2,$3,$4)', [req.user.id, await bcrypt.hash(password, 10), 'changed in account', ipOf(req)]);
  res.json({ ok: true });
}));

// Add or change email: a code is sent to the NEW address and must be confirmed. body: { email }
router.post('/email/request', requireAuth, h(async (req, res) => {
  const devCode = await issueCode({ email: req.body?.email || '', purpose: 'verify_email', userId: req.user.id, ip: ipOf(req) });
  res.json({ sent: true, message: `We sent a code to ${req.body.email}.`, minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code }
router.post('/email/verify', requireAuth, h(async (req, res) => {
  const userId = await checkCode(req.body?.email || '', 'verify_email', req.body?.code, ipOf(req));
  if (userId !== req.user.id) return res.status(400).json({ error: 'That code is not valid. Please ask for a new one.' });
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: publicUser(rows[0]) });
}));

export default router;
