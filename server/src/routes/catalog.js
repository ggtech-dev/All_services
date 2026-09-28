import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM site_settings');
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.name, c.icon, c.description, c.image_url, c.image_credit, c.color,
              count(s.id)::int AS service_count
         FROM categories c
         LEFT JOIN services s ON s.category_id = c.id AND s.is_active
        WHERE c.is_active
        GROUP BY c.id
        ORDER BY c.sort_order`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/categories/:slug', async (req, res, next) => {
  try {
    const cat = await query('SELECT * FROM categories WHERE slug = $1 AND is_active', [req.params.slug]);
    if (!cat.rows[0]) return res.status(404).json({ error: 'Category not found' });

    const services = await query(
      `SELECT id, slug, name, description, image_url, image_credit, base_price, price_unit, eta_minutes, requires_license
         FROM services WHERE category_id = $1 AND is_active ORDER BY sort_order`,
      [cat.rows[0].id]
    );
    res.json({ category: cat.rows[0], services: services.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
