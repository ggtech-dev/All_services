import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { query } from './db.js';

// Shop bill, shop UPI QR and customer payment screenshots. Private: never served as static files,
// only streamed to the order's customer, its agent, and admins.
export const ORDER_DIR = path.resolve(import.meta.dirname, '../private_uploads/orders');
mkdirSync(ORDER_DIR, { recursive: true });

export const FILE_COLUMN = { bill: 'bill_photo', qr: 'shop_qr_photo', proof: 'payment_proof_photo', list: 'list_photo' };

export const orderPhotoUpload = (fields) =>
  multer({
    storage: multer.diskStorage({
      destination: ORDER_DIR,
      filename: (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: fields.length },
    fileFilter: (req, file, cb) => {
      const ok = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype);
      cb(ok ? null : Object.assign(new Error('Please upload a photo (JPG or PNG)'), { status: 400 }), ok);
    },
  }).fields(fields.map((name) => ({ name, maxCount: 1 })));

export const uploadedName = (req, field) => req.files?.[field]?.[0]?.filename ?? null;

export const removeOrderFiles = (names) =>
  Promise.all(names.filter(Boolean).map((n) => unlink(path.join(ORDER_DIR, path.basename(n))).catch(() => {})));

// Files uploaded in a request that then failed are removed again.
export const discardUploads = (req) => removeOrderFiles(Object.values(req.files || {}).flat().map((f) => f.filename));

// After delivery / cancellation: forget the shop's QR and UPI ID and delete the QR file.
export async function clearShopPaymentDetails(orderId) {
  const { rows } = await query('SELECT fn_clear_shop_payment_details($1) AS file', [orderId]);
  if (rows[0]?.file) await removeOrderFiles([rows[0].file]);
}

// Streams one of an order's photos. `where` limits which orders the caller may see.
export async function sendOrderFile(res, orderId, kind, where = 'true', params = []) {
  const column = FILE_COLUMN[kind];
  if (!column) return res.status(404).json({ error: 'Unknown file' });
  const { rows } = await query(`SELECT ${column} AS file FROM orders WHERE id = $1 AND (${where})`, [orderId, ...params]);
  if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
  if (!rows[0].file) return res.status(404).json({ error: 'Not uploaded' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(ORDER_DIR, path.basename(rows[0].file)));
}

// Replace file names in API responses with simple "is there a photo" flags.
export function withPhotoFlags(order) {
  if (!order) return order;
  const out = { ...order, has_bill_photo: !!order.bill_photo, has_shop_qr: !!order.shop_qr_photo, has_payment_proof: !!order.payment_proof_photo, has_list_photo: !!order.list_photo };
  delete out.list_photo;
  delete out.bill_photo;
  delete out.shop_qr_photo;
  delete out.payment_proof_photo;
  return out;
}
