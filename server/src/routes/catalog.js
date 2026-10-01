import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/localities', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name, pincode, lat::float AS lat, lng::float AS lng FROM localities WHERE is_active ORDER BY name');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/service-types', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT code, name, agent_title, icon, fn_subscription_by_skill() -> code AS subscription
         FROM service_types WHERE is_active ORDER BY sort_order, name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

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
      `SELECT s.id, s.slug, s.name, s.description, s.image_url, s.image_credit, s.base_price, s.price_unit,
              s.eta_minutes, s.requires_license, s.price_on_bill, s.window_from, s.window_to, s.is_featured,
              (SELECT count(*) FROM products p WHERE p.service_id = s.id AND p.is_active)::int AS product_count
         FROM services s WHERE s.category_id = $1 AND s.is_active ORDER BY s.is_featured DESC, s.sort_order`,
      [cat.rows[0].id]
    );
    res.json({ category: cat.rows[0], services: services.rows });
  } catch (err) {
    next(err);
  }
});

// Shops the customer may choose at checkout: ?services=19,2936 (the cart's services).
router.get('/shops', async (req, res, next) => {
  try {
    const ids = String(req.query.services || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, 40).map(Number);
    const { rows } = await query('SELECT fn_shops_for($1) AS list', [ids]);
    res.json(rows[0].list);
  } catch (err) {
    next(err);
  }
});

// Services highlighted on the home page (e.g. fresh vegetables 6–10 AM).
router.get('/featured-services', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.name, s.description, s.image_url, s.image_credit, s.price_unit, s.price_on_bill,
              s.window_from, s.window_to, c.icon AS category_icon, c.color AS category_color,
              (SELECT count(*) FROM products p WHERE p.service_id = s.id AND p.is_active)::int AS product_count
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.is_featured AND s.is_active AND c.is_active
        ORDER BY c.sort_order, s.sort_order`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// A service with the products customers can order in it.
router.get('/services/:slug', async (req, res, next) => {
  try {
    const svc = await query(
      `SELECT s.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.slug = $1 AND s.is_active AND c.is_active`,
      [req.params.slug]
    );
    if (!svc.rows[0]) return res.status(404).json({ error: 'Service not found' });

    const products = await query(
      `SELECT id, slug, name, brand, description, icon, image_url, image_credit, unit, price, mrp, in_stock, sell_by, note_options, section
         FROM products WHERE service_id = $1 AND is_active ORDER BY in_stock DESC, sort_order, id`,
      [svc.rows[0].id]
    );
    res.json({ service: svc.rows[0], products: products.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
