import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ACTIVE, STEPS, VEHICLES, rupees, secondsAgo, stepLabels, statusLabel, time, usePoll, when } from '../orderStatus.jsx';
import MapView from '../components/LazyMap.jsx';

// Live map of the assigned agent coming to the customer. Refreshes every 8 seconds.
function LiveTrack({ orderId, who, icon }) {
  const [live, setLive] = useState(null);
  const load = useCallback(() => api(`/orders/${orderId}/live`).then(setLive).catch(() => {}), [orderId]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 8000);
  if (!live) return null;

  const markers = [{ id: 'home', lat: live.dest.lat, lng: live.dest.lng, emoji: '🏠', color: '#16a34a', label: live.dest.exact ? 'Your location' : 'Your area' }];
  if (live.agent) markers.push({ id: 'agent', ...live.agent, emoji: icon || '🛵', color: '#4f46e5', pulse: true, label: `Your ${who}` });
  const path = (live.trail || []).map((p) => [p.lat, p.lng]);

  return (
    <section className="panel live-panel">
      <div className="live-head">
        {live.agent ? (
          <>
            <b>{icon || '🛵'} {live.distance_km} km away · arriving in ~{live.eta_minutes} min</b>
            <small className="muted">Updated {secondsAgo(live.agent.age_seconds)}</small>
          </>
        ) : (
          <b className="muted">📡 Waiting for your {who}'s location…</b>
        )}
      </div>
      <MapView markers={markers} path={path} fitKey={live.agent ? 'agent' : 'home'} height={300} />
    </section>
  );
}

// Live tracking page for one order. Refreshes every 8 seconds while the order is active.
export default function OrderTrack() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 8000, !!order && ACTIVE.includes(order.status));

  if (error) return <div className="alert">{error} — <Link to="/orders">My orders</Link></div>;
  if (!order) return <div className="center-block"><div className="spinner" /></div>;

  const isService = order.kind === 'service';
  const who = (order.agent_title || (isService ? 'partner' : 'delivery partner')).toLowerCase();
  const stepIndex = STEPS.indexOf(order.status);
  const labels = stepLabels(order.kind);
  const stepTime = { placed: order.created_at, assigned: order.assigned_at, picked_up: order.picked_up_at, delivered: order.delivered_at };
  const canCancel = ['placed', 'assigned'].includes(order.status);

  const cancel = async () => {
    const reason = prompt('Why do you want to cancel? (optional)');
    if (reason === null) return;
    setBusy(true);
    try {
      await api(`/orders/${order.id}/cancel`, { method: 'POST', body: { reason } });
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="track">
      <Link to="/orders" className="back-link">← My orders</Link>
      {params.get('new') && order.status === 'placed' && (
        <div className="placed-banner">🎉 {isService ? 'Booking confirmed!' : 'Order placed!'} We're finding the nearest {who} for you.</div>
      )}

      <section className="panel track-head">
        <div>
          <small className="muted">{isService ? 'Booking' : 'Order'} #{order.id} · {when(order.created_at)}</small>
          <h1>{statusLabel(order.status, order.kind)}</h1>
          {order.status === 'placed' && <p className="muted">Waiting for a nearby {who} to accept…<span className="pulse" /></p>}
          {order.status === 'assigned' && <p className="muted">{order.agent_name} accepted your {isService ? 'booking' : 'order'} and will {isService ? 'come' : 'pick it up'} soon.</p>}
          {order.status === 'picked_up' && <p className="muted">{order.agent_name} is on the way to {order.locality_name}.</p>}
          {order.status === 'delivered' && <p className="muted">{isService ? 'Completed' : 'Delivered'} at {time(order.delivered_at)}. Thank you!</p>}
          {order.status === 'cancelled' && <p className="muted">Cancelled: {order.cancel_reason}</p>}
        </div>
        {order.otp_required && ['assigned', 'picked_up'].includes(order.status) && (
          <div className="otp-box" title={`Share this code with the ${who} only when you receive the ${isService ? 'service' : 'order'}`}>
            <small>Delivery OTP</small>
            <b>{order.delivery_otp}</b>
            <small>Share only at your door</small>
          </div>
        )}
      </section>

      {order.status !== 'cancelled' && (
        <ol className="stepper-track">
          {STEPS.map((s, i) => (
            <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}>
              <span className="step-dot">{i < stepIndex || order.status === 'delivered' ? '✓' : i + 1}</span>
              <span className="step-label">{labels[i]}</span>
              <small className="muted">{time(stepTime[s])}</small>
            </li>
          ))}
        </ol>
      )}

      {['assigned', 'picked_up'].includes(order.status) && <LiveTrack orderId={order.id} who={who} icon={order.skill_icon} />}

      <div className="track-grid">
        {order.agent_name && (
          <section className="panel agent-card">
            <div className="agent-avatar">{order.agent_name[0]}</div>
            <div className="agent-info">
              <small className="muted">Your {who} {order.skill_icon}</small>
              <b>{order.agent_name}</b>
              <small className="muted">{VEHICLES[order.vehicle_type]} {order.vehicle_number && `· ${order.vehicle_number}`}</small>
            </div>
            {ACTIVE.includes(order.status) && order.agent_phone && (
              <a className="btn btn-primary btn-sm" href={`tel:${order.agent_phone}`}>📞 Call</a>
            )}
          </section>
        )}

        <section className="panel">
          <h3>{isService ? 'Service' : 'Items'}</h3>
          <ul className="summary-lines">
            {order.items.map((i) => (
              <li key={i.id}>
                <span className="summary-icon">{i.icon || order.icon}</span>
                <div className="summary-name"><b>{i.name}</b><small className="muted">{i.unit}{i.qty > 1 && ` · ${i.qty} × ${rupees(i.price)}`}</small></div>
                <span className="summary-price">{rupees(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <div className="totals">
            <div><span>Items</span><span>{rupees(order.subtotal)}</span></div>
            {!isService && <div><span>Delivery</span><span>{Number(order.delivery_fee) ? rupees(order.delivery_fee) : <b className="free">FREE</b>}</span></div>}
            <div className="grand"><span>{order.status === 'delivered' ? 'Paid' : 'To pay (cash on delivery)'}</span><span>{rupees(order.total)}</span></div>
          </div>
        </section>

        <section className="panel">
          <h3>Delivery to</h3>
          <p className="address">
            <b>{order.contact_name}</b> · {order.contact_phone}<br />
            {order.address_line}<br />
            {order.landmark && <>{order.landmark}<br /></>}
            {order.locality_name}{order.pincode && ` – ${order.pincode}`}, Hyderabad
          </p>
          {order.slot && <p className="muted small">🕒 {order.slot}</p>}
          {order.notes && <p className="muted small">📝 {order.notes}</p>}
          {canCancel && (
            <button className="btn btn-ghost btn-sm danger-text" onClick={cancel} disabled={busy}>Cancel {isService ? 'booking' : 'order'}</button>
          )}
        </section>
      </div>
    </div>
  );
}
