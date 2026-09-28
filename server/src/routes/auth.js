import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const publicUser = (u) => ({ id: u.id, username: u.username, fullName: u.full_name, phone: u.phone, role: u.role });

const signToken = (u) =>
  jwt.sign({ id: u.id, username: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', async (req, res, next) => {
  try {
    const { username, password, fullName, phone } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username))
      return res.status(400).json({ error: 'Username must be 3-30 letters, numbers, _ or .' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, phone)
       VALUES (lower($1), $2, $3, $4) RETURNING *`,
      [username, hash, fullName || null, phone || null]
    );
    res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    // portal: 'user' (default) or 'admin' — the tab chosen on the login page.
    const { username, password, portal = 'user' } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const { rows } = await query('SELECT * FROM users WHERE username = lower($1)', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid username or password' });
    if (portal === 'admin' && user.role !== 'admin')
      return res.status(403).json({ error: 'This account does not have admin access. Please use the User login.' });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

export default router;
