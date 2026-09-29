import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, useLoad, useToast } from './ui.jsx';
import MapView, { secondsAgo } from '../components/MapView.jsx';
import { ACTIVE, STATUS, StatusBadge, VEHICLES, rupees, statusLabel, time, usePoll, when } from '../orderStatus.jsx';

const TABS = [
  ['active', 'Active'],
  ['placed', 'Waiting for agent'],
  ['assigned', 'Assigned'],
  ['picked_up', 'On the way'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
  ['', 'All'],
];

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState({ status: 'active', q: '', date: '', skill: params.get('skill') || '' });
  const types = useLoad(() => api('/service-types'));
  const [openId, setOpenId] = useState(params.get('open') ? Number(params.get('open')) : null);
  const agent = params.get('agent');
  const customer = params.get('customer');

  const qs = new URLSearchParams({ ...(filter.status && { status: filter.status }), ...(filter.q && { q: filter.q }), ...(filter.date && { date: filter.date }), ...(filter.skill && { skill: filter.skill }), ...(agent && { agent }), ...(customer && { customer }) });
  const list = useLoad(() => api(`/admin/orders?${qs}`), [qs.toString()]);
  const stats = useLoad(() => api('/admin/orders-stats'));
  const refresh = () => {
    list.reload();
    stats.reload();
  };
  usePoll(refresh, 15000);

  const s = stats.data;
  return (
    <div className="stack">
      {s && (
        <div className="stat-grid">
          <button className="stat-tile tile-btn" onClick={() => setFilter({ ...filter, status: 'placed' })}>
            <span className="stat-icon warn-icon">⏳</span>
            <div><div className="stat-label">Waiting for agent</div><div className="stat-value">{s.waiting}</div><div className="stat-sub">{s.agents_free} agent{s.agents_free === 1 ? '' : 's'} free now</div></div>
          </button>
          <button className="stat-tile tile-btn" onClick={() => setFilter({ ...filter, status: 'active' })}>
            <span className="stat-icon">🛵</span>
            <div><div className="stat-label">In progress</div><div className="stat-value">{s.in_progress}</div><div className="stat-sub">{s.agents_busy} agent{s.agents_busy === 1 ? '' : 's'} busy</div></div>
          </button>
          <button className="stat-tile tile-btn" onClick={() => setFilter({ ...filter, status: 'delivered' })}>
            <span className="stat-icon ok-icon">✅</span>
            <div><div className="stat-label">Delivered today</div><div className="stat-value">{s.delivered_today}</div><div className="stat-sub">{s.today_orders} orders today · {s.cancelled_today} cancelled</div></div>
          </button>
          <div className="stat-tile">
            <span className="stat-icon">₹</span>
            <div><div className="stat-label">Revenue today</div><div className="stat-value">{rupees(s.revenue_today)}</div><div className="stat-sub">{rupees(s.cash_with_agents)} cash with agents</div></div>
          </div>
        </div>
      )}

      {s?.waiting_no_agent > 0 && (
        <div className="gap-alert">
          ⚠️ {s.waiting_no_agent} waiting order{s.waiting_no_agent > 1 ? 's have' : ' has'} no active agent of the right type.
          <Link to="/admin/service-types"> See agent types</Link> to add or assign agents.
        </div>
      )}

      {(agent || customer) && (
        <div className="filter-note">
          Showing orders for this {agent ? 'agent' : 'customer'} only.
          <button className="link-btn" onClick={() => setParams({})}>Show all orders</button>
        </div>
      )}

      <div className="toolbar">
        <div className="tabs scroll-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter.status === k} className={filter.status === k ? 'active' : ''} onClick={() => setFilter({ ...filter, status: k })}>
              {label}
              {k === 'placed' && s?.waiting > 0 && <span className="count alert-count">{s.waiting}</span>}
            </button>
          ))}
        </div>
        <input className="toolbar-search" placeholder="🔍 Order #, customer, phone or area…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.skill} onChange={(e) => setFilter({ ...filter, skill: e.target.value })} aria-label="Agent type">
          <option value="">All agent types</option>
          {types.data?.map((t) => <option key={t.code} value={t.code}>{t.icon} {t.name}</option>)}
        </select>
        <input type="date" value={filter.date} onChange={(e) => setFilter({ ...filter, date: e.target.value })} className="date-input" />
      </div>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Items</th><th>Type</th><th>Total</th><th>Status</th><th>Agent</th><th aria-label="Open" /></tr>
            </thead>
            <tbody>
              {list.data?.map((o) => (
                <tr key={o.id} className={`clickable ${o.status === 'placed' ? 'row-waiting' : ''}`} onClick={() => setOpenId(o.id)}>
                  <td className="nowrap"><b>#{o.id}</b><div className="muted small">{when(o.created_at)}</div></td>
                  <td>
                    <b>{o.contact_name}</b>
                    <div className="muted small">{o.contact_phone} · {o.locality_name}</div>
                  </td>
                  <td className="summary-cell">{o.summary}</td>
                  <td className="nowrap"><span className="skill-chip small">{o.skill_icon} {o.skill_name}</span></td>
                  <td className="nowrap"><b>{rupees(o.total)}</b></td>
                  <td><StatusBadge status={o.status} kind={o.kind} /></td>
                  <td>{o.agent_name ? <><b>{o.agent_name}</b><div className="muted small">{o.agent_phone}</div></> : <span className="muted">—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.data && !list.data.length && <p className="empty">No orders here yet. New customer orders appear automatically.</p>}
        </div>
        {list.data && <div className="table-foot muted">{list.data.length} orders · refreshes every 15 seconds</div>}
      </section>

      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

function OrderLiveMap({ orderId, icon }) {
  const [live, setLive] = useState(null);
  const load = useCallback(() => api(`/admin/orders/${orderId}/live`).then(setLive).catch(() => {}), [orderId]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 8000);
  if (!live) return null;
  const markers = [{ id: 'dest', lat: live.dest_lat, lng: live.dest_lng, emoji: '🏠', color: '#16a34a', label: live.exact_pin ? 'Customer pin' : 'Customer area' }];
  if (live.agent_lat != null) markers.push({ id: 'agent', lat: live.agent_lat, lng: live.agent_lng, emoji: icon || '🛵', color: '#4f46e5', pulse: true, label: `Agent · ${secondsAgo(live.age_seconds)}` });
  return (
    <section>
      <h4>Live tracking <span className="muted small">{live.agent_lat != null ? `· ${live.distance_km} km away · ~${live.eta_minutes} min · updated ${secondsAgo(live.age_seconds)}` : '· agent has not shared location yet'}</span></h4>
      <MapView markers={markers} path={live.trail.map((p) => [p.lat, p.lng])} fitKey={live.agent_lat != null ? 'both' : 'dest'} height={240} />
    </section>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/admin/orders/${id}`).then(setOrder).catch((e) => toast(e.message, 'error')), [id, toast]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 10000, !!order && ACTIVE.includes(order.status));

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      await load();
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!order) return <Modal title={`Order #${id}`} onClose={onClose} wide><div className="center-block"><div className="spinner" /></div></Modal>;

  const canAssign = ['placed', 'assigned'].includes(order.status);
  const canCancel = ACTIVE.includes(order.status);
  const stamps = [
    ['Placed', order.created_at], ['Assigned', order.assigned_at], ['Picked up', order.picked_up_at],
    [order.kind === 'service' ? 'Completed' : 'Delivered', order.delivered_at], ['Cancelled', order.cancelled_at],
  ].filter(([, t]) => t);

  return (
    <Modal title={`${order.kind === 'service' ? 'Booking' : 'Order'} #${order.id}`} onClose={onClose} wide>
      <div className="od">
        <div className="od-head">
          <StatusBadge status={order.status} kind={order.kind} />
          <span className="skill-chip small">{order.skill_icon} {order.skill_name}</span>
          <span className="muted small">{stamps.map(([l, t]) => `${l} ${time(t)}`).join(' · ')}</span>
          {order.otp_required && ACTIVE.includes(order.status) && <span className="od-otp" title="Customer's delivery OTP">OTP {order.delivery_otp}</span>}
        </div>

        <div className="od-grid">
          <section>
            <h4>Customer</h4>
            <p><b>{order.contact_name}</b> · <a href={`tel:${order.contact_phone}`}>{order.contact_phone}</a></p>
            <p className="muted small">Account @{order.customer_username} · <Link to={`/admin/orders?customer=${order.customer_id}`} onClick={onClose}>all their orders</Link></p>
            <h4>Address</h4>
            <p className="small">{order.address_line}{order.landmark && `, ${order.landmark}`}<br />{order.locality_name}{order.pincode && ` – ${order.pincode}`}</p>
            {order.slot && <p className="small">🕒 {order.slot}</p>}
            {order.notes && <p className="small od-note">📝 {order.notes}</p>}
          </section>

          <section>
            <h4>{order.kind === 'service' ? 'Service' : 'Items'}</h4>
            <ul className="od-items">
              {order.items.map((i) => (
                <li key={i.id}><span>{i.icon || order.icon} {i.name} <small className="muted">{i.unit}</small></span><span>{i.qty} × {rupees(i.price)}</span></li>
              ))}
            </ul>
            <div className="totals">
              <div><span>Subtotal</span><span>{rupees(order.subtotal)}</span></div>
              <div><span>Delivery</span><span>{Number(order.delivery_fee) ? rupees(order.delivery_fee) : 'Free'}</span></div>
              <div className="grand"><span>Total (COD)</span><span>{rupees(order.total)}</span></div>
            </div>
          </section>
        </div>

        <section className="od-agent">
          <h4>{order.agent_title}</h4>
          {order.agent_name ? (
            <p><b>{order.agent_name}</b> · <a href={`tel:${order.agent_phone}`}>{order.agent_phone}</a> · {VEHICLES[order.vehicle_type]} {order.vehicle_number}</p>
          ) : (
            <p className="muted">Not assigned yet — {order.skill_name} agents near {order.locality_name} can see this order.</p>
          )}
          {canAssign && !order.candidates.length && (
            <p className="gap-alert small">No active {order.skill_name} agents. <Link to="/admin/agents" onClick={onClose}>Add one</Link> or give an agent this type of work.</p>
          )}
          {canAssign && order.candidates.length > 0 && (
            <div className="assign-row">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">{order.agent_name ? 'Re-assign to…' : 'Assign to an agent…'}</option>
                {order.candidates.map((a) => (
                  <option key={a.user_id} value={a.user_id} disabled={a.user_id === order.agent_id}>
                    {a.state === 'free' ? '🟢' : a.state === 'busy' ? '🔵' : '⚪'} {a.full_name} — {a.state}{a.distance_km != null ? ` · ${a.distance_km} km` : ''}{a.locality_name ? ` (${a.locality_name})` : ''}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" disabled={!agentId || busy}
                onClick={() => act(() => api(`/admin/orders/${order.id}/assign`, { method: 'POST', body: { agent_id: Number(agentId) } }), 'Agent assigned')}>
                Assign
              </button>
            </div>
          )}
        </section>

        {['assigned', 'picked_up'].includes(order.status) && <OrderLiveMap orderId={order.id} icon={order.skill_icon} />}

        <section>
          <h4>Timeline</h4>
          <ol className="timeline">
            {order.events.map((e, i) => (
              <li key={i} style={{ '--c': STATUS[e.status]?.color }}>
                <b>{statusLabel(e.status, order.kind)}</b>
                <span className="muted small"> · {when(e.created_at)}{e.actor_name && ` · by ${e.actor_name}${e.actor_role !== 'customer' ? ` (${e.actor_role})` : ''}`}</span>
                {e.note && <div className="small">{e.note}</div>}
              </li>
            ))}
          </ol>
        </section>

        {canCancel && (
          <div className="od-foot">
            <button className="btn btn-ghost btn-sm danger-text" disabled={busy}
              onClick={() => {
                const reason = prompt('Reason for cancelling (shown to the customer):');
                if (reason !== null) act(() => api(`/admin/orders/${order.id}/cancel`, { method: 'POST', body: { reason } }), 'Order cancelled');
              }}>
              Cancel order
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

