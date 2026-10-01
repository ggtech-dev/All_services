import { useEffect, useState } from 'react';
import { api, apiFile } from '../api.js';
import { rupees, time } from '../orderStatus.jsx';
import PhotoPicker from './PhotoPicker.jsx';
import QrScanner, { readUpiQrFile } from './QrScanner.jsx';
import { doorPayment } from './DeliveryCharge.jsx';
import { useSettings } from '../settings.js';

// ---------- helpers ----------

// Photo that needs login to see (bill, QR, payment screenshot). Click opens it full size.
export function PrivateImage({ path, alt, className = '' }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let url;
    apiFile(path)
      .then((f) => {
        url = f.url;
        setFile(f);
      })
      .catch(() => setError(true));
    return () => url && URL.revokeObjectURL(url);
  }, [path]);
  if (error) return <div className={`private-img missing ${className}`}>⚠️</div>;
  if (!file) return <div className={`private-img loading ${className}`} />;
  return (
    <a className={`private-img ${className}`} href={file.url} target="_blank" rel="noreferrer" title="Open full size">
      <img src={file.url} alt={alt} />
    </a>
  );
}

// upi://pay link: opens GPay / PhonePe / Paytm with the shop and amount filled in.
// The UPI ID is validated on the server (letters, digits, . _ - and one @), so it goes in as-is, like the NPCI examples;
// names use %20 for spaces because some UPI apps show "+" literally.
export const upiLink = (order) =>
  `upi://pay?pa=${order.shop_upi_id}&pn=${encodeURIComponent(order.shop_name || 'Shop')}` +
  `&am=${Number(order.bill_amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`All Services order ${order.id}`)}`;

// ---------- agent: at the shop ----------
export function AgentShopBill({ order, busy, run }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', shop_name: order.preferred_shop || '', mode: 'customer_upi', upi_id: '' });
  const [billFile, setBillFile] = useState(null);
  const [qrFile, setQrFile] = useState(null);
  const [qrMsg, setQrMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [formError, setFormError] = useState('');
  const hasBill = !!order.bill_uploaded_at;
  const upi = order.bill_payment_mode === 'customer_upi';
  const base = `/agent/orders/${order.id}`;

  const startEdit = () => {
    setForm({
      amount: hasBill ? String(Number(order.bill_amount)) : '',
      shop_name: order.shop_name || order.preferred_shop || '',
      mode: order.bill_payment_mode || 'customer_upi',
      upi_id: order.shop_upi_id || '',
    });
    setBillFile(null);
    setQrFile(null);
    setQrMsg('');
    setFormError('');
    setOpen(true);
  };

  const onQr = async (file) => {
    setQrFile(file);
    if (!file) return;
    setQrMsg('Reading QR…');
    try {
      const r = await readUpiQrFile(file);
      if (r) {
        setForm((f) => ({ ...f, upi_id: r.upiId, shop_name: f.shop_name || r.name }));
        setQrMsg(`✓ Read from QR: ${r.upiId}${r.name ? ` (${r.name})` : ''}`);
      } else {
        setQrMsg('Could not read the QR — type the UPI ID printed below it');
      }
    } catch {
      setQrMsg('Could not read the QR — type the UPI ID printed below it');
    }
  };

  // Live scan found the QR: keep the frame as the QR photo and fill in the UPI details.
  const onScanned = ({ file, upiId, name }) => {
    setScanning(false);
    setQrFile(file);
    setForm((f) => ({ ...f, upi_id: upiId, shop_name: f.shop_name || name }));
    setQrMsg(`✓ Scanned: ${upiId}${name ? ` (${name})` : ''}`);
  };

  const submit = (e) => {
    e.preventDefault();
    setFormError('');
    if (!hasBill && !billFile) return setFormError('Add a photo of the bill');
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (billFile) fd.append('bill_photo', billFile);
    if (qrFile && form.mode === 'customer_upi') fd.append('qr_photo', qrFile);
    run(async () => {
      await api(`${base}/bill`, { method: 'POST', body: fd });
      setOpen(false);
    }, form.mode === 'customer_upi' ? 'Bill sent — the customer can now pay the shop' : 'Bill saved');
  };

  if (open) {
    return (
      <form className="shop-bill-form" onSubmit={submit}>
        <b>🧾 Shop bill</b>
        <div className="form-row">
          <label>Bill amount (₹) *<input type="number" min="1" step="any" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required autoFocus /></label>
          <label>Shop name<input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="e.g. Sri Balaji Kirana" /></label>
        </div>
        <PhotoPicker label={hasBill ? 'Bill photo' : 'Bill photo *'} file={billFile} onFile={setBillFile} hasExisting={hasBill} />
        <div className="seg">
          <button type="button" className={form.mode === 'customer_upi' ? 'active' : ''} onClick={() => setForm({ ...form, mode: 'customer_upi' })}>📱 Customer pays shop (UPI)</button>
          <button type="button" className={form.mode === 'agent_cash' ? 'active' : ''} onClick={() => setForm({ ...form, mode: 'agent_cash' })}>💵 I paid cash</button>
        </div>
        {form.mode === 'customer_upi' ? (
          <>
            <button type="button" className="btn btn-primary btn-block scan-btn" onClick={() => setScanning(true)}>🔳 Scan shop's UPI QR (live camera)</button>
            <PhotoPicker label="…or a photo of the shop's QR" file={qrFile} onFile={onQr} hasExisting={order.has_shop_qr} />
            {scanning && <QrScanner onResult={onScanned} onClose={() => setScanning(false)} />}
            {qrMsg && <small className={qrMsg.startsWith('✓') ? 'success-text' : 'muted'}>{qrMsg}</small>}
            <label>Shop UPI ID<input value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value.trim() })} placeholder="e.g. balajikirana@okaxis" autoCapitalize="none" /></label>
          </>
        ) : (
          <small className="muted">You paid the shop. The customer pays you {form.amount ? rupees(Number(form.amount) + Number(order.delivery_fee)) : 'the bill + delivery fee'} on delivery.</small>
        )}
        {formError && <div className="alert">{formError}</div>}
        <div className="shop-bill-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy}>{form.mode === 'customer_upi' ? 'Send bill to customer' : 'Save bill'}</button>
        </div>
      </form>
    );
  }

  if (!hasBill) {
    return (
      <div className="shop-bill-box">
        <span>🧾 Buying at a shop? Add the bill so the customer can pay the shop directly by UPI.</span>
        <button className="btn btn-ghost btn-sm" onClick={startEdit}>Add shop bill</button>
      </div>
    );
  }

  return (
    <div className="shop-bill-box filled">
      <div className="bill-top">
        <PrivateImage path={`${base}/files/bill`} alt="Shop bill" className="thumb-sm" />
        <div>
          <b>{rupees(order.bill_amount)}</b> {order.shop_name && <span className="muted">at {order.shop_name}</span>}
          <div className="small">{upi ? `Customer pays shop by UPI · ${order.shop_upi_id || 'QR'}` : 'You paid cash at the shop'}</div>
        </div>
        {!order.customer_paid_at && !order.payment_confirmed_at && <button className="link-btn" onClick={startEdit}>Edit</button>}
      </div>
      {upi && !order.payment_confirmed_at && (
        order.customer_paid_at ? (
          <div className="pay-status paid">
            <PrivateImage path={`${base}/files/proof`} alt="Customer payment screenshot" className="thumb-sm" />
            <div>
              <b>Customer says they paid ✓</b>
              <div className="small">{time(order.customer_paid_at)}{order.payment_ref && ` · UPI ref ${order.payment_ref}`}</div>
              <div className="small muted">Check with the shopkeeper, then confirm.</div>
            </div>
          </div>
        ) : (
          <div className="pay-status waiting">⏳ Waiting for the customer to pay {rupees(order.bill_amount)} to the shop…</div>
        )
      )}
      {upi && !order.payment_confirmed_at && (
        <button className="btn btn-primary btn-block btn-success" disabled={busy}
          onClick={() => (order.customer_paid_at || confirm('The customer has not uploaded a payment screenshot. Did the shopkeeper confirm the money was received?')) &&
            run(() => api(`${base}/confirm-payment`, { method: 'POST' }), 'Payment confirmed — you can pick up the order')}>
          ✅ Shop received payment
        </button>
      )}
      {upi && order.payment_confirmed_at && <div className="pay-status paid">✅ Shop received {rupees(order.bill_amount)} · {time(order.payment_confirmed_at)}</div>}
    </div>
  );
}

// ---------- customer: pay the shop ----------
export function CustomerShopBill({ order, onChanged }) {
  const [file, setFile] = useState(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (!order.bill_uploaded_at) return null;
  const base = `/orders/${order.id}`;
  const upi = order.bill_payment_mode === 'customer_upi';
  const needsPayment = upi && !order.customer_paid_at && !order.payment_confirmed_at && order.status === 'assigned';
  const diff = order.estimated_total != null ? Number(order.bill_amount) + Number(order.delivery_fee) - Number(order.estimated_total) : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('payment_photo', file);
      if (ref.trim()) fd.append('ref', ref.trim());
      await api(`${base}/payment-proof`, { method: 'POST', body: fd });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`panel customer-bill ${needsPayment ? 'attention' : ''}`}>
      <div className="bill-top">
        <PrivateImage path={`${base}/files/bill`} alt="Shop bill" className="thumb-md" />
        <div>
          <small className="muted">🧾 Shop bill{order.shop_name && ` · ${order.shop_name}`}</small>
          <h3>{rupees(order.bill_amount)}</h3>
          {diff !== 0 && <small className="muted">App estimate was {rupees(order.estimated_total)} — the shop's bill is the final price.</small>}
          <div className="small muted">Tap the photo to see the full bill.</div>
        </div>
      </div>

      {needsPayment && (
        <div className="pay-box">
          <b>Pay {rupees(order.bill_amount)} to {order.shop_name || 'the shop'}</b>
          {order.shop_upi_id && (
            <a className="btn btn-primary btn-block upi-btn" href={upiLink(order)}>📱 Pay {rupees(order.bill_amount)} with UPI app</a>
          )}
          <div className="pay-alt">
            {order.has_shop_qr && (
              <div className="qr-wrap">
                <PrivateImage path={`${base}/files/qr`} alt="Shop UPI QR" className="qr-img" />
                <small className="muted">Tap to open, then save it and “scan from gallery” in your UPI app</small>
              </div>
            )}
            {order.shop_upi_id && (
              <div className="upi-id">
                <small className="muted">UPI ID</small>
                <b>{order.shop_upi_id}</b>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(order.shop_upi_id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>
          <form className="form proof-form" onSubmit={submit}>
            <b>After paying, upload the payment screenshot</b>
            <PhotoPicker label="Payment screenshot" file={file} onFile={setFile} cameraFirst={false} />
            <label>UPI reference / UTR (optional)<input value={ref} onChange={(e) => setRef(e.target.value.replace(/\s/g, ''))} placeholder="12-digit number from your payment app" inputMode="numeric" /></label>
            {error && <div className="alert">{error}</div>}
            <button className="btn btn-primary" disabled={busy || !file}>{busy ? 'Sending…' : "I've paid — send screenshot"}</button>
          </form>
        </div>
      )}

      {upi && order.customer_paid_at && !order.payment_confirmed_at && (
        <div className="pay-status waiting">✅ Screenshot sent at {time(order.customer_paid_at)} — the agent is confirming with the shop…</div>
      )}
      {upi && order.payment_confirmed_at && <div className="pay-status paid">✅ The shop received your payment of {rupees(order.bill_amount)}</div>}
      {!upi && <div className="pay-status">💵 The agent paid the shop. Pay {rupees(order.total)} to the agent on delivery (cash or UPI).</div>}
      {order.has_payment_proof && !needsPayment && (
        <div className="proof-row"><small className="muted">Your payment screenshot:</small><PrivateImage path={`${base}/files/proof`} alt="Payment screenshot" className="thumb-sm" /></div>
      )}
    </section>
  );
}

// ---------- admin: everything about the shop bill ----------
export function AdminShopBill({ order }) {
  const settings = useSettings();
  if (!order.bill_uploaded_at) return null;
  const base = `/admin/orders/${order.id}/files`;
  const upi = order.bill_payment_mode === 'customer_upi';
  return (
    <section className="admin-bill">
      <h4>🧾 Shop bill & payment</h4>
      <div className="admin-bill-grid">
        <div className="admin-bill-photos">
          <figure><PrivateImage path={`${base}/bill`} alt="Bill" className="thumb-md" /><figcaption>Bill</figcaption></figure>
          {order.has_shop_qr && <figure><PrivateImage path={`${base}/qr`} alt="Shop QR" className="thumb-md" /><figcaption>Shop QR</figcaption></figure>}
          {order.has_payment_proof && <figure><PrivateImage path={`${base}/proof`} alt="Payment" className="thumb-md" /><figcaption>Customer payment</figcaption></figure>}
        </div>
        <dl className="kv small">
          <dt>Shop</dt><dd>{order.shop_name || '—'}</dd>
          <dt>Bill</dt><dd>{rupees(order.bill_amount)} <span className="muted">(app estimate {rupees(order.estimated_total)})</span></dd>
          <dt>Paid by</dt><dd>{upi ? `Customer → shop UPI ${order.shop_upi_id || (order.shop_details_cleared_at ? '(removed after delivery)' : '')}` : 'Agent paid cash; customer pays agent'}</dd>
          {upi && <><dt>Customer paid</dt><dd>{order.customer_paid_at ? `${time(order.customer_paid_at)}${order.payment_ref ? ` · ref ${order.payment_ref}` : ''}` : '—'}</dd></>}
          {upi && <><dt>Shop confirmed</dt><dd>{order.payment_confirmed_at ? time(order.payment_confirmed_at) : 'Not yet'}</dd></>}
          <dt>Agent collects (cash)</dt><dd>{rupees(doorPayment(order, settings).cash)}</dd>
        </dl>
      </div>
    </section>
  );
}
