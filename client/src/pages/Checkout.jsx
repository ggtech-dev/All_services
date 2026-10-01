import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { itemNote, useCart } from '../cart.jsx';
import { qtyLabel, slotLabel } from '../qty.js';
import { rupees } from '../orderStatus.jsx';
import MapView from '../components/LazyMap.jsx';

const nearestLocality = (list, lat, lng) =>
  list.reduce((best, l) => {
    const d = (l.lat - lat) ** 2 + (l.lng - lng) ** 2;
    return !best || d < best.d ? { ...l, d } : best;
  }, null);

// Delivery / visit times: "As soon as possible", today's 2-hour windows that are still ahead (starting at least
// 30 minutes from now), then tomorrow's. Services with a fixed window (vegetables 6–10 AM) use the server's slots.
const WINDOWS = { products: [[7, 9], [9, 11], [12, 14], [15, 17], [17, 19], [19, 21]], service: [[9, 11], [11, 13], [14, 16], [16, 18], [18, 20]] };
const hr = (h) => ({ n: h % 12 || 12, m: h < 12 ? 'AM' : 'PM' });
const span = ([a, b]) => (hr(a).m === hr(b).m ? `${hr(a).n}–${hr(b).n} ${hr(b).m}` : `${hr(a).n} ${hr(a).m}–${hr(b).n} ${hr(b).m}`);
function buildSlots(kind, now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000); // India time
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const today = WINDOWS[kind].filter(([a]) => a * 60 >= minutes + 30).map((w) => `Today ${span(w)}`);
  const tomorrow = WINDOWS[kind].slice(0, Math.max(2, 5 - today.length)).map((w) => `Tomorrow ${span(w)}`);
  return ['As soon as possible', ...today, ...tomorrow];
}

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
  const [shops, setShops] = useState([]);
  const [shopChoice, setShopChoice] = useState(''); // '' = any good shop, a shop id, or 'other'
  const [shopOther, setShopOther] = useState('');
  const [form, setForm] = useState({ name: user.fullName || '', phone: user.phone || '', address_line: '', landmark: '', locality_id: '', pincode: '' });
  const [slotOptions] = useState(() => ({ products: buildSlots('products'), service: buildSlots('service') }));
  const SLOTS = slotOptions;
  const [slot, setSlot] = useState(SLOTS[kind][0]);
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState(null); // { lat, lng, accuracy } from the phone's GPS
  const [pinMsg, setPinMsg] = useState('');

  const pinMyLocation = () => {
    if (!navigator.geolocation) return setPinMsg('Location is not available on this device');
    setPinMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), accuracy: Math.round(pos.coords.accuracy) };
        setPin(p);
        setPinMsg('');
        // Pick the nearest area automatically if the customer hasn't chosen one.
        const l = nearestLocality(localities, p.lat, p.lng);
        if (l && !form.locality_id) setForm((f) => ({ ...f, locality_id: String(l.id), pincode: f.pincode || l.pincode || '' }));
      },
      () => setPinMsg('Please allow location access, or just fill in the address'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
    api('/orders/last-address').then((a) => {
      if (a) setForm({ name: a.contact_name, phone: a.contact_phone, address_line: a.address_line, landmark: a.landmark || '', locality_id: String(a.locality_id), pincode: a.pincode || '' });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (serviceSlug) api(`/services/${serviceSlug}`).then((d) => setService(d.service)).catch((e) => setError(e.message));
  }, [serviceSlug]);

  // The customer's own list (kirana…): typed lines with a name, and/or a photo of a handwritten list.
  const ownLines = cart.lines.filter((l) => l.name.trim());
  const listServiceIds = [...new Set([...ownLines.map((l) => l.service_id), ...(cart.photo ? [cart.photo.service_id] : [])])].join(',');

  // Delivery/visit charge for exactly this cart (highest charge among its shops) or this booking.
  const productIds = cart.items.map((i) => i.product_id).join(',');
  useEffect(() => {
    const parts = [productIds && `products=${productIds}`, listServiceIds && `lists=${listServiceIds}`].filter(Boolean).join('&');
    const q = kind === 'service' ? (service ? `service=${service.id}` : null) : parts || null;
    if (q) api(`/orders/quote?${q}`).then(setQuote).catch(() => {});
  }, [kind, service, productIds, listServiceIds]);

  // Shops the customer may choose (for items bought at a shop: vegetables, meat, kirana…)
  const shopServiceIds = [...new Set([...cart.items.filter((i) => i.on_bill && i.service_id).map((i) => i.service_id), ...(listServiceIds ? listServiceIds.split(',').map(Number) : [])])].join(',');
  useEffect(() => {
    if (kind !== 'products' || !shopServiceIds) return setShops([]);
    api(`/shops?services=${shopServiceIds}`).then(setShops).catch(() => setShops([]));
  }, [kind, shopServiceIds]);

  // Daily services deliver only in their time window: pick one of the slots the server offers.
  const windowSlots = quote.slots || null;
  useEffect(() => {
    if (windowSlots && !windowSlots.includes(slot)) setSlot(windowSlots[0] || '');
    if (!windowSlots && !SLOTS[kind].includes(slot)) setSlot(SLOTS[kind][0]);
  }, [windowSlots, slot, kind]);

  // A saved address from an area we no longer serve: ask for the area again.
  useEffect(() => {
    if (localities.length && form.locality_id && !localities.some((l) => String(l.id) === form.locality_id)) {
      setForm((f) => ({ ...f, locality_id: '', pincode: '' }));
    }
  }, [localities, form.locality_id]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const chooseLocality = (e) => {
    const l = localities.find((x) => String(x.id) === e.target.value);
    setForm({ ...form, locality_id: e.target.value, pincode: l?.pincode || form.pincode });
  };

  const lines = kind === 'service'
    ? service ? [{ key: 's', icon: service.category_icon, name: service.name, unit: service.price_unit, qty: 1, price: Number(service.base_price) }] : []
    : [
        ...cart.items.map((i) => ({
          key: i.product_id, icon: i.icon, name: i.name, unit: i.unit, qty: i.qty, price: i.price, product_id: i.product_id,
          sell_by: i.sell_by || 'pack', on_bill: !!i.on_bill, note: itemNote(i),
        })),
        ...ownLines.map((l) => ({ key: `own-${l.key}`, own: l, icon: '✍️', name: l.name.trim(), unit: l.qty_text.trim() || 'how much?', qty: 1, price: 0, on_bill: true })),
        ...(cart.photo ? [{ key: 'photo', photo: true, icon: '📷', name: 'Photo of your list', unit: cart.photo.service_name, qty: 1, price: 0, on_bill: true }] : []),
      ];
  // items priced by the shop bill (vegetables, meat…) are paid as per the bill, not included here
  const subtotal = lines.reduce((n, l) => n + (l.on_bill ? 0 : l.price * l.qty), 0);
  const hasBill = lines.some((l) => l.on_bill);
  const fee = quote.delivery_fee;
  const toPay = !hasBill ? rupees(subtotal + fee) : subtotal + fee > 0 ? `${rupees(subtotal + fee)} + shop bill` : 'As per shop bill';
  const feeName = kind === 'service' ? 'Visit charge' : 'Delivery charge';

  if (kind === 'products' && !cart.items.length && !ownLines.length && !cart.photo) {
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
      const body = { contact: { ...form, locality_id: Number(form.locality_id), ...(pin && { lat: pin.lat, lng: pin.lng }) }, slot, notes };
      if (kind === 'service') body.service_id = service.id;
      else {
        body.items = [
          ...lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: l.qty, ...(l.note && { note: l.note }) })),
          ...ownLines.map((l) => ({ service_id: l.service_id, name: l.name.trim(), qty_text: l.qty_text.trim() })),
        ];
        // only a photo, nothing typed for that shop: one line points to the photo
        if (cart.photo && !ownLines.some((l) => l.service_id === cart.photo.service_id)) {
          body.items.push({ service_id: cart.photo.service_id, name: 'Items in the photo', qty_text: 'see photo' });
        }
        if (shopChoice === 'other') body.shop_name = shopOther.trim();
        else if (shopChoice) body.shop_id = Number(shopChoice);
      }
      let payload = body;
      if (kind === 'products' && cart.photo) {
        payload = new FormData();
        payload.append('data', JSON.stringify(body));
        payload.append('list_photo', cart.photo.file);
      }
      const order = await api('/orders', { method: 'POST', body: payload });
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
          <div className="pin-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={pinMyLocation}>📍 {pin ? 'Update my location' : 'Use my current location'}</button>
            {pin ? <small className="success-text">Exact location pinned ✓ (±{pin.accuracy} m) — the {kind === 'service' ? 'partner' : 'agent'} will navigate right to your door</small>
              : <small className="muted">{pinMsg || 'Optional: helps the agent find your door'}</small>}
          </div>
          {pin && <MapView markers={[{ id: 'pin', lat: pin.lat, lng: pin.lng, emoji: '🏠', color: '#16a34a', accuracy_m: pin.accuracy }]} fitKey={`${pin.lat},${pin.lng}`} height={180} />}
        </section>

        <section className="panel form">
          <h3>{kind === 'service' ? '🗓️ Preferred time' : '🕒 Delivery time'}</h3>
          {quote.window_conflict && (
            <div className="alert">Some items in your cart are delivered at different times of the day. Please order them separately.</div>
          )}
          {quote.window && <p className="muted small">🕕 These items are delivered between <b>{quote.window.label}</b>.</p>}
          <div className="slot-grid">
            {(windowSlots || SLOTS[kind]).map((s) => (
              <button type="button" key={s} className={`slot ${slot === s ? 'active' : ''}`} onClick={() => setSlot(s)}>{windowSlots ? slotLabel(s) : s}</button>
            ))}
          </div>
          <label>Instructions (optional)<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'service' ? 'Describe the problem, e.g. kitchen tap leaking' : 'e.g. Ring the bell, leave with security'} /></label>
        </section>

        {kind === 'products' && hasBill && (
          <section className="panel form">
            <h3>🏪 Shop <span className="muted small">(optional)</span></h3>
            <p className="muted small">Want your items from a particular shop? Choose it — your delivery partner will buy only there.</p>
            <select value={shopChoice} onChange={(e) => setShopChoice(e.target.value)} aria-label="Shop">
              <option value="">Any good shop — let the delivery partner choose</option>
              {shops.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}{sh.locality_name ? ` — ${sh.locality_name}` : ''}</option>)}
              <option value="other">Another shop (type the name)…</option>
            </select>
            {shopChoice === 'other' && (
              <input value={shopOther} onChange={(e) => setShopOther(e.target.value.slice(0, 80))} placeholder="Shop name and area, e.g. Sri Lakshmi Kirana, Bharath Nagar" required />
            )}
          </section>
        )}

        <section className="panel">
          <h3>💵 Payment</h3>
          <label className="pay-option">
            <input type="radio" checked readOnly /> <b>Pay on delivery</b> <span className="muted">— pay the {kind === 'service' ? 'expert' : 'agent'} when it arrives</span>
          </label>
          {hasBill && <p className="muted small">🧾 Market-price items (vegetables, meat, kirana…): your delivery partner buys them and shares a photo of the <b>shop bill</b> in your order — you pay exactly that amount.</p>}
          {fee > 0 && <p className="muted small">The {feeName.toLowerCase()} ({rupees(fee)}) is paid by UPI to All Services — scan the QR on the {kind === 'service' ? "expert's" : "agent's"} phone or tap “Pay with UPI app” in your order.</p>}
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
                {l.note && <small className="item-note">✂️ {l.note}</small>}
              </div>
              {l.own || l.photo ? (
                <button type="button" className="link-btn danger-text" onClick={() => (l.photo ? cart.setPhoto(null) : cart.removeLine(l.own.key))} aria-label={`Remove ${l.name}`}>Remove</button>
              ) : kind === 'products' ? (
                <div className="stepper small-stepper">
                  <button type="button" onClick={() => cart.less(l.product_id)} aria-label={`Less ${l.name}`}>−</button>
                  <span>{l.sell_by === 'pack' ? l.qty : qtyLabel(l.qty, l.sell_by)}</span>
                  <button type="button" onClick={() => cart.more(l.product_id)} aria-label={`More ${l.name}`}>+</button>
                </div>
              ) : null}
              <span className="summary-price">{l.on_bill ? <small className="market-price">as per bill</small> : rupees(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="totals">
          {(subtotal > 0 || !hasBill) && <div><span>{kind === 'service' ? 'Service charge' : 'Items total'}</span><span>{rupees(subtotal)}</span></div>}
          {hasBill && <div><span>Market-price items</span><span>as per shop bill</span></div>}
          {(kind === 'products' || quote.base_fee > 0) && (
            <div>
              <span>{feeName}</span>
              <span>{fee === 0 ? <b className="free">FREE</b> : rupees(fee)}</span>
            </div>
          )}
          {fee === 0 && quote.base_fee > 0 && quote.free_left > 0 && (
            <small className="success-text">🎉 {quote.free_left} free {quote.free_left === 1 ? 'delivery' : 'deliveries'} left for new customers</small>
          )}
          <div className="grand"><span>To pay</span><span>{toPay}</span></div>
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !lines.length || quote.window_conflict || (windowSlots && !windowSlots.length)}>
          {busy ? 'Placing…' : kind === 'service' ? `Confirm booking · ${toPay}` : hasBill ? 'Place order' : `Place order · ${toPay}`}
        </button>
        <p className="muted small center">{hasBill ? 'Market-price items are charged exactly as per the shop bill.' : 'Prices are checked again when you place the order.'}</p>
      </aside>
    </form>
  );
}
