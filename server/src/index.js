import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch {
    res.status(500).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`All Services API running on http://localhost:${port}`));
