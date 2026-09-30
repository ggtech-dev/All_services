import { useState } from 'react';
import { api } from '../api.js';
import { rupees, time } from '../orderStatus.jsx';
import { useSettings } from '../settings.js';

// ---------- helpers ----------

export const feeLabel = (o) => (o.kind === 'service' ? 'Visit charge' : 'Delivery charge');

// upi://pay link: opens GPay / PhonePe / Paytm with the payee and amount filled in.
// UPI IDs are validated on the server, so they go in as-is; names use %20 because some apps show "+" literally.
export const upiPayLink = ({ upiId, name, amount, note }) =>
  `upi://pay?pa=${upiId}&pn=${encodeURIComponent(name || 'All Services')}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

// What is paid at the door, and how:
//  - the delivery/visit charge goes to the company UPI QR (or cash, if the agent marks it so or no company QR is set up)
//  - everything else still due is cash to the agent (the shop bill is left out when the customer paid the shop by UPI).
export function doorPayment(o, settings = {}) {
  const fee = Number(o.delivery_fee || 0);
  const upiBill = o.bill_payment_mode === 'customer_upi' ? Number(o.bill_amount || 0) : 0;
  const itemsCash = Math.max(0, Number(o.total) - fee - upiBill);
  const companyUpi = !!settings.company_upi_id;
  const feeMode = o.fee_payment_mode || (companyUpi ? 'company_upi' : 'cash');
  return { fee, itemsCash, feeMode, feePaid: !!o.fee_paid_at, companyUpi, cash: itemsCash + (feeMode === 'cash' ? fee : 0) };
}

// ---------- the company QR ----------

export function CompanyQr({ amount, big = false }) {
  const s = useSettings();
  if (!s.company_upi_id) {
    return <p className="muted small">The company UPI QR is not set up yet. Ask the admin to add it (Admin → Delivery charges).</p>;
  }
  return (
    <div className={`company-qr ${big ? 'company-qr-big' : ''}`}>
      {s.company_qr_url ? <img src={s.company_qr_url} alt={`UPI QR of ${s.company_upi_name || 'All Services'}`} /> : <div className="company-qr-missing">🔳</div>}
      <b>{s.company_upi_name || 'All Services'}</b>
      <code>{s.company_upi_id}</code>
      {amount > 0 && <div className="company-qr-amount">Amount to pay: <b>{rupees(amount)}</b></div>}
    </div>
  );
}

function QrModal({ amount, onClose }) {
  return (
    <div className="qr-scanner" role="dialog" aria-label="Company UPI QR" onClick={onClose}>
      <div className="company-qr-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="muted small">Customer scans this with any UPI app (GPay, PhonePe, Paytm…)</p>
        <CompanyQr amount={amount} big />
        <p className="small">After paying, the customer shows you the <b>payment success</b> screen.</p>
        <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ---------- agent: at the customer's door ----------

// Items/bill cash + the delivery charge (company UPI or cash). "Delivered" stays locked until the charge is confirmed.
export function AgentDoorPayment({ order, busy, run }) {
  const s = useSettings();
  const p = doorPayment(order, s);
  const [showQr, setShowQr] = useState(false);
  const [changing, setChanging] = useState(false);
  const label = feeLabel(order);
  const atDoor = order.status === 'picked_up';
  const mark = (mode) =>
    run(
      () => api(`/agent/orders/${order.id}/fee-received`, { method: 'POST', body: { mode } }),
      mode === 'company_upi' ? `✓ ${label} received on company UPI` : `✓ ${label} collected in cash`
    ).then(() => setChanging(false));

  return (
    <div className="door-pay">
      <div className="collect">
        💵 {p.itemsCash > 0 ? <>Collect <b>{rupees(p.itemsCash)}</b> in cash{p.fee > 0 ? ` for the ${order.kind === 'service' ? 'service' : 'items'}` : ''}</> : <>No cash to collect{p.fee > 0 ? ` for the ${order.kind === 'service' ? 'service' : 'items'}` : ''}</>}
      </div>

      {p.fee > 0 && (
        <div className={`fee-box ${p.feePaid && !changing ? 'fee-paid' : ''}`}>
          <div className="fee-head">
            <span>🚚 {label}</span>
            <b>{rupees(p.fee)}</b>
          </div>

          {!atDoor && (
            <small className="muted">
              {p.companyUpi ? 'The customer pays this to All Services by UPI when you reach them.' : 'Collect this in cash when you reach the customer.'}
            </small>
          )}

          {atDoor && p.feePaid && !changing && (
            <div className="fee-done">
              <span className="success-text">✓ {p.feeMode === 'company_upi' ? 'Received on company UPI' : 'Collected in cash'} · {time(order.fee_paid_at)}</span>
              <button type="button" className="link-btn" onClick={() => setChanging(true)}>Change</button>
            </div>
          )}

          {atDoor && (!p.feePaid || changing) && (
            <div className="fee-actions">
              {p.companyUpi ? (
                <>
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => setShowQr(true)}>🔳 Show company QR to customer</button>
                  <small className="muted">Customer scans it, pays {rupees(p.fee)}, and shows you the payment success screen.</small>
                  <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => mark('company_upi')}>
                    ✅ Received {rupees(p.fee)} on company UPI
                  </button>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => mark('cash')}>💵 Customer paid {rupees(p.fee)} in cash instead</button>
                </>
              ) : (
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => mark('cash')}>
                  💵 Collected {rupees(p.fee)} in cash
                </button>
              )}
              {changing && <button type="button" className="link-btn muted" onClick={() => setChanging(false)}>Keep as it was</button>}
            </div>
          )}
        </div>
      )}
      {showQr && <QrModal amount={p.fee} onClose={() => setShowQr(false)} />}
    </div>
  );
}

// ---------- customer: order page ----------

export function CustomerDoorPayment({ order }) {
  const s = useSettings();
  const p = doorPayment(order, s);
  if (!p.fee || order.status === 'cancelled') return null;
  const label = feeLabel(order);

  if (p.feePaid || order.status === 'delivered') {
    return (
      <section className="panel fee-card fee-paid">
        ✅ {label} {rupees(p.fee)} paid {p.feeMode === 'company_upi' ? 'to All Services by UPI' : 'in cash'}
      </section>
    );
  }
  if (!p.companyUpi) return null; // paid in cash with the rest; shown in the bill below

  const arriving = order.status === 'picked_up';
  return (
    <section className={`panel fee-card ${arriving ? 'attention' : ''}`}>
      <div className="fee-head">
        <b>🚚 {label}</b>
        <b>{rupees(p.fee)}</b>
      </div>
      <p className="small">Pay this to <b>{s.company_upi_name || 'All Services'}</b> by UPI when your order arrives, and show the payment success screen to the {order.kind === 'service' ? 'expert' : 'delivery partner'}.</p>
      {arriving ? (
        <>
          <a className="btn btn-primary btn-block upi-btn" href={upiPayLink({ upiId: s.company_upi_id, name: s.company_upi_name, amount: p.fee, note: `All Services order ${order.id} ${label.toLowerCase()}` })}>
            📱 Pay {rupees(p.fee)} with UPI app
          </a>
          <small className="muted">Or scan the QR on the {order.kind === 'service' ? "expert's" : "delivery partner's"} phone · UPI ID <code>{s.company_upi_id}</code></small>
        </>
      ) : (
        <small className="muted">The pay button appears here when your order is on the way.</small>
      )}
    </section>
  );
}

// ---------- admin: order totals line ----------

export function feeStatusText(order) {
  if (!Number(order.delivery_fee)) return '';
  if (order.fee_paid_at) return `${order.fee_payment_mode === 'company_upi' ? 'paid to company UPI' : 'paid in cash'} · ${time(order.fee_paid_at)}`;
  return order.status === 'cancelled' ? 'not collected' : 'not paid yet';
}
