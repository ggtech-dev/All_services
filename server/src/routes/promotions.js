import { Router } from 'express';
import { query } from '../db.js';

// Public: promotions for the customer home page, plus view / click counting.
const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Where a promotion takes the customer. Services with products open their shop, others open booking.
export const HREF_SQL = `CASE p.link_type
    WHEN 'category' THEN '/category/' || p.link_value
    WHEN 'service' THEN CASE WHEN EXISTS (SELECT 1 FROM products pr JOIN services sv ON sv.id = pr.service_id
                                           WHERE sv.slug = p.link_value AND pr.is_active)
                             THEN '/service/' || p.link_value ELSE '/checkout?service=' || p.link_value END
    WHEN 'url' THEN p.link_value
  END`;

router.get('/', h(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.title, p.subtitle, p.image_url, p.cta_text, p.link_type, p.placement, p.bg_color, p.text_color,
            ${HREF_SQL} AS href
       FROM promotions p
      WHERE fn_promotion_state(p) = 'live'
      ORDER BY p.placement, p.sort_order, p.id`
  );
  res.set('Cache-Control', 'no-store');
  res.json({ carousel: rows.filter((r) => r.placement === 'carousel'), tiles: rows.filter((r) => r.placement === 'tile') });
}));

// body: { ids: [1, 2, 3] } — promotions that were shown on screen.
router.post('/seen', h(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 20);
  if (ids.length) await query('CALL sp_promotion_views($1)', [ids]);
  res.status(204).end();
}));

router.post('/:id/click', h(async (req, res) => {
  await query('CALL sp_promotion_click($1)', [Number(req.params.id)]);
  res.status(204).end();
}));

export default router;
