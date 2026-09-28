import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.jsx';
import { rupees } from '../orderStatus.jsx';

const SLOTS = {
  products: ['As soon as possible', 'Today 7–9 AM', 'Today 12–2 PM', 'Today 5–7 PM', 'Tomorrow 7–9 AM', 'Tomorrow 5–7 PM'],
  service: ['As soon as possible', 'Today 10 AM–12 PM', 'Today 2–4 PM', 'Today 4–6 PM', 'Tomorrow 10 AM–12 PM', 'Tomorrow 2–4 PM'],
};

// Checkout for the cart (products) or for booking one service (?service=<slug>).
export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const serviceSlug = params.get('service');
  const kind = serviceSlug ? 'service' : 'products';

  const [service, setService] = useState(null);
  const [localities, setLocalities] = useState([]);
  const [quote, setQuote] = useState({ delivery_fee: 0, free_left: 0 });
  const [form, setForm] = useState({ name: user.fullName || '', phone: user.phone || '', address_line: '', landmark: '', locality_id: '', pincode: '' });
  const [slot, setSlot] = useState(SLOTS[kind][0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
    api('/orders/quote').then(setQuote).catch(() => {});
    api('/orders/last-address').then((a) => {
      if (a) setForm({ name: a.contact_name, phone: a.contact_phone, address_line: a.address_line, landmark: a.landmark || '', locality_id: String(a.locality_id), pincode: a.pincode || '' });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (serviceSlug) api(`/services/${serviceSlug}`).then((d) => setService(d.service)).catch((e) => setError(e.message));
  }, [serviceSlug]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const chooseLocality = (e) => {
    const l = localities.find((x) => String(x.id) === e.target.value);
    setForm({ ...form, locality_id: e.target.value, pincode: l?.pincode || form.pincode });
  };

  const lines = kind === 'service'
    ? service ? [{ key: 's', icon: service.category_icon, name: service.name, unit: service.price_unit, qty: 1, price: Number(service.base_price) }] : []
    : cart.items.map((i) => ({ key: i.product_id, icon: i.icon, name: i.name, unit: i.unit, qty: i.qty, price: i.price, product_id: i.product_id }));
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const fee = kind === 'service' ? 0 : quote.delivery_fee;

  if (kind === 'products' && !cart.items.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🛒</div>
        <h2>Your cart is empty</h2>
        <p className="muted">Add milk, vegetables, kirana and more from the shops.</p>
        <Link to="/" className="btn btn-primary">Start shopping</Link>
      </div>
    );
  }

  const place = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { contact: { ...form, locality_id: Number(form.locality_id) }, slot, notes };
      if (kind === 'service') body.service_id = service.id;
      else body.items = cart.items.map((i) => ({ product_id: i.product_id, qty: i.qty }));
      const order = await api('/orders', { method: 'POST', body });
      if (kind === 'products') cart.clear();
      navigate(`/orders/${order.id}?new=1`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="checkout" onSubmit={place}>
      <div className="checkout-main">
        <h1>{kind === 'service' ? 'Book service' : 'Checkout'}</h1>

        <section className="panel form">
          <h3>📍 Delivery address</h3>
          <div className="form-row">
            <label>Name<input value={form.name} onChange={set('name')} required placeholder="Who will receive it" /></label>
            <label>Mobile number<input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile" /></label>
          </div>
          <label>House / flat no., building, street<input value={form.address_line} onChange={set('address_line')} required placeholder="e.g. Flat 202, Sai Residency, Road 5" /></label>
          <div className="form-row">
            <label>
              Area
              <select value={form.locality_id} onChange={chooseLocality} required>
                <option value="">Choose your area…</option>
                {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label>Pincode<input value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} placeholder="500072" /></label>
          </div>
          <label>Landmark (optional)<input value={form.landmark} onChange={set('landmark')} placeholder="e.g. Near KPHB metro station" /></label>
        </section>

        <section className="panel form">
          <h3>{kind === 'service' ? '🗓️ Preferred time' : '🕒 Delivery time'}</h3>
          <div className="slot-grid">
            {SLOTS[kind].map((s) => (
              <button type="button" key={s} className={`slot ${slot === s ? 'active' : ''}`} onClick={() => setSlot(s)}>{s}</button>
            ))}
          </div>
          <label>Instructions (optional)<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'service' ? 'Describe the problem, e.g. kitchen tap leaking' : 'e.g. Ring the bell, leave with security'} /></label>
        </section>

        <section className="panel">
          <h3>💵 Payment</h3>
          <label className="pay-option">
            <input type="radio" checked readOnly /> <b>Cash on delivery</b> <span className="muted">— pay the agent in cash or UPI when it arrives</span>
          </label>
        </section>
      </div>

      <aside className="checkout-side panel">
        <h3>Order summary</h3>
        <ul className="summary-lines">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="summary-icon">{l.icon}</span>
              <div className="summary-name">
                <b>{l.name}</b>
                <small className="muted">{l.unit}</small>
              </div>
              {kind === 'products' ? (
                <div className="stepper small-stepper">
                  <button type="button" onClick={() => cart.setQty(l.product_id, l.qty - 1)} aria-label="Less">−</button>
                  <span>{l.qty}</span>
                  <button type="button" onClick={() => cart.setQty(l.product_id, l.qty + 1)} aria-label="More">+</button>
                </div>
              ) : null}
              <span className="summary-price">{rupees(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div><span>{kind === 'service' ? 'Service charge' : 'Items total'}</span><span>{rupees(subtotal)}</span></div>
          {kind === 'products' && (
            <div>
              <span>Delivery fee</span>
              <span>{fee === 0 ? <b className="free">FREE</b> : rupees(fee)}</span>
            </div>
          )}
          {kind === 'products' && fee === 0 && quote.free_left > 0 && (
            <small className="success-text">🎉 {quote.free_left} free {quote.free_left === 1 ? 'delivery' : 'deliveries'} left for new customers</small>
          )}
          <div className="grand"><span>To pay</span><span>{rupees(subtotal + fee)}</span></div>
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !lines.length}>
          {busy ? 'Placing…' : kind === 'service' ? `Confirm booking · ${rupees(subtotal)}` : `Place order · ${rupees(subtotal + fee)}`}
        </button>
        <p className="muted small center">Prices are confirmed by the store when you place the order.</p>
      </aside>
    </form>
  );
}
