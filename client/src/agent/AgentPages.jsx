import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { CompanyQr } from '../components/DeliveryCharge.jsx';
import { StatusBadge, VEHICLES, rupees, when } from '../orderStatus.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';

// ---------- delivery history ----------
export function AgentOrders() {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    api('/agent/orders?scope=history').then(setOrders).catch(() => setOrders([]));
  }, []);
  if (!orders) return <div className="center-block"><div className="spinner" /></div>;

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
  if (!data) return <div className="center-block"><div className="spinner" /></div>;
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
        </dl>
      </section>
      <AccountSecurity />
      <p className="muted small center">To change your name, phone, vehicle or documents, please contact the admin.</p>
      <button className="btn btn-ghost btn-block" onClick={logout}>⎋ Logout</button>
    </div>
  );
}
