-- "Buy at a shop" flow for product orders. Re-runnable.
-- The agent uploads the shop's bill (photo + amount) and the shop's UPI QR; the customer pays the shop by UPI
-- and uploads a payment screenshot; the agent confirms the shop received it. Photos live in
-- server/private_uploads/orders and are only served to the order's customer, its agent and admins.
-- After delivery / cancellation the shop's QR and UPI ID are removed.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_total      NUMERIC(10,2);  -- total from app prices, before the real bill
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_amount          NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_photo           TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_name            VARCHAR(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_payment_mode    VARCHAR(12) CHECK (bill_payment_mode IN ('customer_upi', 'agent_cash'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_upi_id          VARCHAR(120);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_qr_photo        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_uploaded_at     TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_photo  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref          VARCHAR(40);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_paid_at     TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_details_cleared_at TIMESTAMPTZ;

-- Adds a note to the order timeline without changing the status (e.g. "Bill uploaded: ₹800").
CREATE OR REPLACE PROCEDURE sp_order_note(p_order_id INT, p_note TEXT)
LANGUAGE sql SET search_path FROM CURRENT AS $$
  INSERT INTO order_events (order_id, status, note, actor_id)
  SELECT id, status, p_note, fn_current_actor() FROM orders WHERE id = p_order_id;
$$;

-- Agent uploads (or corrects) the shop bill. Allowed while the order is assigned and not yet paid.
-- Returns the previous photo file names so the API can delete replaced files.
CREATE OR REPLACE FUNCTION fn_agent_upload_bill(
  p_agent_id INT, p_order_id INT, p_amount NUMERIC, p_shop_name TEXT, p_mode TEXT, p_upi_id TEXT,
  p_bill_photo TEXT, p_qr_photo TEXT
) RETURNS TABLE (old_bill_photo TEXT, old_qr_photo TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
  v_upi TEXT := nullif(trim(coalesce(p_upi_id, '')), '');
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.kind <> 'products' THEN
    RAISE EXCEPTION 'Shop bills are only for item orders' USING ERRCODE = '22023';
  END IF;
  IF v.status <> 'assigned' THEN
    RAISE EXCEPTION 'Upload the bill at the shop, before picking up the order' USING ERRCODE = '55000';
  END IF;
  IF v.customer_paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'The customer has already paid this bill — it can no longer be changed' USING ERRCODE = '55000';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 50000 THEN
    RAISE EXCEPTION 'Enter the bill amount (₹1 – ₹50,000)' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_bill_photo, v.bill_photo) IS NULL THEN
    RAISE EXCEPTION 'Take a photo of the shop bill' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('customer_upi', 'agent_cash') THEN
    RAISE EXCEPTION 'Choose how the shop is paid' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'customer_upi' THEN
    IF v_upi IS NULL AND coalesce(p_qr_photo, v.shop_qr_photo) IS NULL THEN
      RAISE EXCEPTION 'Add the shop''s UPI QR photo or UPI ID so the customer can pay' USING ERRCODE = '22023';
    END IF;
    IF v_upi IS NOT NULL AND v_upi !~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z][A-Za-z0-9.-]{1,64}$' THEN
      RAISE EXCEPTION 'That UPI ID doesn''t look right (example: shopname@okaxis)' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN p_bill_photo IS NOT NULL THEN v.bill_photo END,
    CASE WHEN p_qr_photo IS NOT NULL OR p_mode = 'agent_cash' THEN v.shop_qr_photo END;

  UPDATE orders
     SET estimated_total   = coalesce(estimated_total, total),
         bill_amount       = round(p_amount, 2),
         total             = round(p_amount, 2) + delivery_fee,
         bill_photo        = coalesce(p_bill_photo, bill_photo),
         shop_name         = nullif(trim(coalesce(p_shop_name, '')), ''),
         bill_payment_mode = p_mode,
         shop_upi_id       = CASE WHEN p_mode = 'customer_upi' THEN v_upi END,
         shop_qr_photo     = CASE WHEN p_mode = 'customer_upi' THEN coalesce(p_qr_photo, shop_qr_photo) END,
         bill_uploaded_at  = now()
   WHERE id = p_order_id;

  CALL sp_order_note(p_order_id,
    format('Shop bill uploaded: ₹%s%s — %s', round(p_amount, 2),
           CASE WHEN nullif(trim(coalesce(p_shop_name, '')), '') IS NOT NULL THEN ' at ' || trim(p_shop_name) ELSE '' END,
           CASE WHEN p_mode = 'customer_upi' THEN 'customer to pay the shop by UPI' ELSE 'agent paid cash, customer pays on delivery' END));
END $$;

-- Customer uploads the screenshot of their UPI payment to the shop.
-- Returns the previous screenshot file (if replaced) so the API can delete it.
CREATE OR REPLACE FUNCTION fn_customer_payment_proof(p_customer_id INT, p_order_id INT, p_photo TEXT, p_ref TEXT)
RETURNS TEXT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.bill_uploaded_at IS NULL OR v.bill_payment_mode <> 'customer_upi' THEN
    RAISE EXCEPTION 'There is no shop bill to pay for this order' USING ERRCODE = '55000';
  END IF;
  IF v.status <> 'assigned' OR v.payment_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This payment is already done' USING ERRCODE = '55000';
  END IF;
  IF p_photo IS NULL THEN
    RAISE EXCEPTION 'Upload the screenshot of your payment' USING ERRCODE = '22023';
  END IF;
  IF p_ref IS NOT NULL AND trim(p_ref) <> '' AND trim(p_ref) !~ '^[A-Za-z0-9-]{6,35}$' THEN
    RAISE EXCEPTION 'The UPI reference should be the 12-digit number from your payment app' USING ERRCODE = '22023';
  END IF;

  UPDATE orders SET payment_proof_photo = p_photo, payment_ref = nullif(trim(coalesce(p_ref, '')), ''), customer_paid_at = now()
   WHERE id = p_order_id;
  CALL sp_order_note(p_order_id, format('Customer paid ₹%s to the shop by UPI%s', v.bill_amount,
                                        CASE WHEN nullif(trim(coalesce(p_ref, '')), '') IS NOT NULL THEN ' (ref ' || trim(p_ref) || ')' ELSE '' END));
  RETURN v.payment_proof_photo;
END $$;

-- Agent confirms the shopkeeper received the customer's UPI payment. Only then can the order be picked up.
CREATE OR REPLACE PROCEDURE sp_agent_confirm_payment(p_agent_id INT, p_order_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.bill_payment_mode IS DISTINCT FROM 'customer_upi' OR v.status <> 'assigned' THEN
    RAISE EXCEPTION 'Nothing to confirm for this order' USING ERRCODE = '55000';
  END IF;
  UPDATE orders SET payment_confirmed_at = now() WHERE id = p_order_id;
  CALL sp_order_note(p_order_id, format('Shop confirmed the customer''s payment of ₹%s', v.bill_amount)
                                 || CASE WHEN v.customer_paid_at IS NULL THEN ' (customer had not uploaded a screenshot)' ELSE '' END);
END $$;

-- Removes the shop's QR photo and UPI ID once the order is finished. Returns the QR file to delete.
CREATE OR REPLACE FUNCTION fn_clear_shop_payment_details(p_order_id INT) RETURNS TEXT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_file TEXT;
BEGIN
  UPDATE orders o
     SET shop_qr_photo = NULL, shop_upi_id = NULL, shop_details_cleared_at = now()
    FROM (SELECT id, shop_qr_photo FROM orders WHERE id = p_order_id FOR UPDATE) old
   WHERE o.id = old.id AND o.status IN ('delivered', 'cancelled')
     AND (o.shop_qr_photo IS NOT NULL OR o.shop_upi_id IS NOT NULL)
  RETURNING old.shop_qr_photo INTO v_file;
  RETURN v_file;
END $$;
