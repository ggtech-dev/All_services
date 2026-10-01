import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CompanyQr } from '../components/DeliveryCharge.jsx';
import { InstallButton } from '../components/InstallApp.jsx';
import { StatusBadge, VEHICLES, rupees, when } from '../orderStatus.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';
import AlertsCard from '../components/AlertsCard.jsx';
import SupportLinks from '../components/SupportLinks.jsx';
import Skeleton from '../components/Skeleton.jsx';

// ---------- delivery history ----------
export function AgentOrders() {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    api('/agent/orders?scope=history').then(setOrders).catch(() => setOrders([]));
  }, []);
  if (!orders) return <Skeleton variant="list" />;

  // Group by day for a simple daily report.
  const days = orders.reduce((acc, o) => {
    const day = new Date(o.delivered_at || o.created_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    (acc[day] ||= []).push(o);
    return acc;
  }, {});

  return (
    <div className="agent-stack">
      <h2 className="agent-h2">My deliveries</h2>
      {!orders.length && <div className="agent-empty">No completed deliveries yet. Go online from Home to start.</div>}
      {Object.entries(days).map(([day, list]) => {
        const delivered = list.filter((o) => o.status === 'delivered');
        return (
          <section key={day}>
            <div className="day-head">
              <b>{day}</b>
              <span className="muted">{delivered.length} delivered · {rupees(delivered.reduce((n, o) => n + Number(o.agent_earning || 0), 0))} earned</span>
            </div>
            {list.map((o) => (
              <div key={o.id} className="history-row">
                <div>
                  <b>#{o.id}</b> <StatusBadge status={o.status} kind={o.kind} />
                  <p className="muted small">{o.contact_name} · {o.locality_name}</p>
                  <p className="small">{o.summary}</p>
                </div>
                <div className="history-side">
                  {o.status === 'delivered' && <b className="earn">+{rupees(o.agent_earning)}</b>}
                  <small className="muted">{when(o.delivered_at || o.created_at)}</small>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const TYPE = {
  earning: { label: 'Delivery earning', sign: '+', cls: 'plus' },
  bonus: { label: 'Bonus', sign: '+', cls: 'plus' },
  payout: { label: 'Paid to you', sign: '−', cls: 'minus' },
  cod_collected: { label: 'Cash collected (COD)', sign: '', cls: 'cash' },
  cod_deposited: { label: 'Cash deposited', sign: '', cls: 'cash' },
};

// ---------- wallet & reports ----------
export function AgentWallet() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/agent/wallet').then(setData).catch(() => {});
  }, []);
  if (!data) return <Skeleton variant="list" />;
  const s = data.stats;
  const max = Math.max(1, ...s.last7.map((d) => d.deliveries));

  return (
    <div className="agent-stack">
      <section className="wallet-card">
        <small>Wallet balance</small>
        <b>{rupees(s.wallet_balance)}</b>
        <div className="wallet-sub">
          <span>Lifetime earned <b>{rupees(s.lifetime_earnings)}</b></span>
          <span>Paid out <b>{rupees(s.paid_out)}</b></span>
        </div>
      </section>

      {Number(s.cash_in_hand) > 0 && (
        <div className="cash-alert">💵 You are holding <b>{rupees(s.cash_in_hand)}</b> cash from COD orders. Please deposit it with the office.</div>
      )}

      <section className="panel">
        <h3 className="agent-h3">Last 7 days</h3>
        <div className="week-chart">
          {s.last7.map((d) => (
            <div key={d.day} className="week-col" title={`${d.deliveries} deliveries · ${rupees(d.earnings)}`}>
              <small>{d.deliveries || ''}</small>
              <div className="week-bar" style={{ height: `${(d.deliveries / max) * 100}%` }} />
              <span>{new Date(d.day).toLocaleDateString('en-IN', { weekday: 'narrow' })}</span>
            </div>
          ))}
        </div>
        <div className="agent-report-grid">
          <div><small>Total deliveries</small><b>{s.total_deliveries}</b></div>
          <div><small>Avg. time per order</small><b>{s.avg_delivery_minutes != null ? `${s.avg_delivery_minutes} min` : '—'}</b></div>
          <div><small>This week</small><b>{rupees(s.last7.reduce((n, d) => n + Number(d.earnings), 0))}</b></div>
        </div>
      </section>

      <section>
        <h3 className="agent-h3">Transactions</h3>
        {!data.entries.length && <div className="agent-empty">No transactions yet.</div>}
        {data.entries.map((e) => (
          <div key={e.id} className="txn-row">
            <div>
              <b>{TYPE[e.type].label}</b>
              <small className="muted">{e.note || (e.order_id && `Order #${e.order_id}`)} · {when(e.created_at)}</small>
            </div>
            <b className={TYPE[e.type].cls}>{TYPE[e.type].sign}{rupees(e.amount)}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------- company UPI QR: customers pay the delivery charge to it ----------
export function AgentPayQr() {
  return (
    <div className="agent-stack">
      <section className="panel pay-qr-page">
        <h2>🔳 Company UPI QR</h2>
        <p className="muted small">
          At the door, show this to the customer. They pay the delivery charge to All Services and show you the
          payment success screen. Then tap <b>“Received on company UPI”</b> in your order.
        </p>
        <CompanyQr big />
      </section>
    </div>
  );
}

// ---------- profile ----------
export function AgentProfile() {
  const { me } = useOutletContext();
  const { logout } = useAuth();
  const a = me.agent;
  return (
    <div className="agent-stack">
      <section className="panel profile-card">
        <div className="agent-avatar">{a.full_name[0]}</div>
        <h2>{a.full_name}</h2>
        <p className="muted">@{a.username} · Agent since {new Date(a.joined_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</p>
      </section>
      <section className="panel">
        <dl className="kv">
          <dt>Mobile</dt><dd>{a.phone}</dd>
          <dt>Email</dt><dd>{a.email || '—'}</dd>
          <dt>Vehicle</dt><dd>{VEHICLES[a.vehicle_type]} {a.vehicle_number}</dd>
          <dt>Area</dt><dd>{a.locality_name || '—'}</dd>
          <dt>Types of work</dt><dd>{(a.skill_list || []).map((s) => `${s.icon} ${s.name}`).join(', ')}</dd>
          <dt>Pay per delivery</dt><dd>{rupees(me.stats.pay_per_order)}</dd>
          <dt>Your rating</dt><dd>{me.stats.rating?.count ? <>★ {me.stats.rating.avg} <span className="muted small">from {me.stats.rating.count} customer{me.stats.rating.count > 1 ? 's' : ''}</span></> : <span className="muted">No ratings yet</span>}</dd>
        </dl>
      </section>
      <Link to="/agent/subscriptions" className="panel sub-link">💳 <b>Subscriptions</b> — earn more from plumber, electrician… orders ›</Link>
      <AlertsCard />
      <AccountSecurity />
      <InstallButton />
      <p className="muted small center">To change your name, phone, vehicle or documents, please contact the admin.</p>
      <SupportLinks title="Contact the admin" className="panel center-links" />
      <button className="btn btn-ghost btn-block" onClick={logout}>⎋ Logout</button>
    </div>
  );
}

// ---------- subscriptions: services whose orders go only to subscribed agents (plumber…) ----------
const SUB_STATE = {
  none: ['Not subscribed', '#64748b'],
  requested: ['Request sent', '#f59e0b'],
  active: ['Active', '#16a34a'],
  expiring: ['Ending soon', '#ea580c'],
  expired: ['Expired', '#64748b'],
  rejected: ['Not approved', '#94a3b8'],
  stopped: ['Stopped', '#dc2626'],
};
const subDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function AgentSubscriptions() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(null);
  const load = () => api('/agent/subscriptions').then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="alert">{error}</div>;
  if (!list) return <Skeleton variant="list" />;
  return (
    <div className="agent-stack">
      <section className="panel">
        <h2>💳 Subscriptions — earn more</h2>
        <p className="muted small">
          Orders for these services go <b>only to subscribed agents</b>. Request one, pay the fee to the company UPI, and the
          admin will call you and switch it on. You can renew in the last 7 days.
        </p>
      </section>
      {!list.length && <p className="muted center">No subscription services right now.</p>}
      {list.map((s) => {
        const [label, color] = SUB_STATE[s.state] || [s.state, '#64748b'];
        const running = s.state === 'active' || s.state === 'expiring';
        const canAsk = s.state === 'none' || s.state === 'expired' || s.state === 'rejected' || s.state === 'stopped' || (s.state === 'expiring' && !s.pending_renewal);
        return (
          <section key={s.service_id} className="panel sub-card">
            <div className="sub-head">
              <div>
                <b>{s.service_icon} {s.service_name}</b>
                <div className="muted small">{rupees(s.fee)} for {s.days} days · {s.agent_title || s.skill_name}</div>
              </div>
              <span className="status-badge" style={{ '--c': color }}>{label}</span>
            </div>
            {running && <p className="small">Active until <b>{subDay(s.paid_until)}</b> · {s.days_left} day{s.days_left === 1 ? '' : 's'} left</p>}
            {s.state === 'requested' && <p className="small">Admin will call you soon. {s.agent_payment_ref ? <>Your UPI ref: <b>{s.agent_payment_ref}</b></> : 'Pay the fee to the company UPI and share the reference.'}</p>}
            {s.pending_renewal && <p className="small">Renewal requested — admin will extend it after checking your payment.</p>}
            {s.admin_note && (s.state === 'rejected' || s.state === 'stopped') && <p className="small muted">Admin: {s.admin_note}</p>}
            {s.open_orders > 0 && !running && <p className="small muted">{s.open_orders} order{s.open_orders > 1 ? 's' : ''} waiting right now for subscribed agents.</p>}
            {(canAsk || s.state === 'requested') && (
              <button className={`btn ${canAsk ? 'btn-primary' : 'btn-ghost'} btn-block`} onClick={() => setAsking(s)}>
                {s.state === 'requested' ? 'Add payment reference' : running ? '↻ Renew' : 'Request subscription'}
              </button>
            )}
          </section>
        );
      })}
      {asking && <SubscriptionRequest sub={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); load(); }} />}
    </div>
  );
}

function SubscriptionRequest({ sub, onClose, onDone }) {
  const [ref, setRef] = useState(sub.agent_payment_ref || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/agent/subscriptions', { method: 'POST', body: { service_id: sub.service_id, payment_ref: ref, note } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="qr-scanner" role="dialog" aria-label="Request subscription" onClick={onClose}>
      <form className="company-qr-sheet" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <h3>{sub.service_icon} {sub.service_name}</h3>
        <p className="muted small">Pay {rupees(sub.fee)} for {sub.days} days to the company UPI (or pay the admin in cash).</p>
        <CompanyQr amount={sub.fee} />
        <label>UPI reference no. (after paying)
          <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} placeholder="optional — e.g. 4123 5678 9012" />
        </label>
        <label>Message to admin
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="optional — e.g. best time to call" />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send to admin'}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}

// Home: a reminder when a subscription is ending soon or has ended.
export function SubscriptionReminder() {
  const [list, setList] = useState([]);
  useEffect(() => {
    api('/agent/subscriptions').then(setList).catch(() => {});
  }, []);
  const s = list.find((x) => x.state === 'expiring' && !x.pending_renewal) || list.find((x) => x.state === 'expired');
  if (!s) return null;
  return (
    <Link to="/agent/subscriptions" className="panel sub-reminder">
      ⏰ <b>{s.service_name}</b> subscription {s.state === 'expired' ? 'has ended' : `ends in ${s.days_left} day${s.days_left === 1 ? '' : 's'}`}
      {' '}— renew to keep getting these orders ›
    </Link>
  );
}
