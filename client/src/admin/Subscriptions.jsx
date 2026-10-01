import { useState } from 'react';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';

// Subscription-only services (plumber, electrician…): their orders go only to agents with an active subscription.
// Agents request in their app → the admin calls them, takes the payment and activates. Renew, extend or stop anytime.
const STATE = {
  requested: ['New request', '#f59e0b'],
  active: ['Active', '#16a34a'],
  expiring: ['Ending soon', '#ea580c'],
  expired: ['Expired', '#64748b'],
  rejected: ['Rejected', '#94a3b8'],
  stopped: ['Stopped', '#dc2626'],
};
const TABS = [
  ['requests', 'Requests'],
  ['members', 'Members'],
  ['expiring', 'Ending soon'],
  ['ended', 'Expired / stopped'],
  ['services', 'Subscription services'],
];
const inTab = {
  requests: (s) => s.state === 'requested' || s.pending_renewal,
  members: (s) => s.state === 'active' || s.state === 'expiring',
  expiring: (s) => s.state === 'expiring',
  ended: (s) => ['expired', 'stopped', 'rejected'].includes(s.state),
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const wa = (phone, text) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;

export default function Subscriptions() {
  const toast = useToast();
  const data = useLoad(() => api('/admin/subscriptions'));
  const [tab, setTab] = useState('requests');
  const [activating, setActivating] = useState(null); // a subscription row, or {} for "add member"
  const d = data.data;
  const subs = d?.subscriptions || [];
  const subServices = (d?.services || []).filter((s) => s.subscription_required);

  const act = async (s, kind) => {
    const reason = prompt(kind === 'stop'
      ? `Stop ${s.agent_name}'s ${s.service_name} subscription now? They stop getting these orders at once.\nReason (optional):`
      : `Reject ${s.agent_name}'s request for ${s.service_name}?\nReason the agent will see (optional):`);
    if (reason === null) return;
    try {
      await api(`/admin/subscriptions/${s.id}/${kind}`, { method: 'POST', body: { reason } });
      toast(kind === 'stop' ? 'Subscription stopped' : 'Request rejected');
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const rows = tab === 'services' ? [] : subs.filter(inTab[tab]);

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Orders of a <b>subscription service</b> go only to agents with an active subscription for it. Agents request it in their
          app; call them, take the payment, then <b>Activate</b>. When it ends they stop getting those orders automatically.
        </p>
        <button className="btn btn-primary" onClick={() => setActivating({})} disabled={!subServices.length}
          title={subServices.length ? '' : 'Turn on a subscription service first'}>➕ Add member</button>
      </div>

      <div className="tabs scroll-tabs" role="tablist">
        {TABS.map(([k, label]) => {
          const n = k === 'services' ? subServices.length : subs.filter(inTab[k]).length;
          return (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label} <span className={`count ${(k === 'requests' || k === 'expiring') && n ? 'alert-count' : ''}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {data.error && <div className="alert">{data.error}</div>}
      {data.loading && !d && <div className="center-block"><div className="spinner" /></div>}

      {d && tab === 'services' && <ServiceSettings services={d.services} onSaved={data.reload} />}

      {d && tab !== 'services' && (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Agent</th><th>Service</th><th>Status</th><th>Paid until</th><th>Payment</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const [label, color] = STATE[s.state] || [s.state, '#64748b'];
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.agent_name}</b>
                        <div className="small">
                          <a className="link" href={`tel:${s.agent_phone}`}>📞 {s.agent_phone}</a>{' · '}
                          <a className="link" target="_blank" rel="noreferrer"
                            href={wa(s.agent_phone, `Hi ${s.agent_name}, this is All Services about your ${s.service_name} subscription (${rupees(s.fee)} for ${s.days} days).`)}>
                            WhatsApp
                          </a>
                        </div>
                      </td>
                      <td>{s.service_name}<div className="muted small">{rupees(s.fee)} / {s.days} days</div></td>
                      <td>
                        <span className="status-badge" style={{ '--c': color }}>{label}</span>
                        {s.pending_renewal && <div className="small" style={{ color: '#ea580c', marginTop: 4 }}>Wants to renew</div>}
                        {s.agent_note && <div className="muted small">“{s.agent_note}”</div>}
                        {s.admin_note && <div className="muted small">Note: {s.admin_note}</div>}
                      </td>
                      <td>
                        {day(s.paid_until)}
                        {(s.state === 'active' || s.state === 'expiring') && <div className="muted small">{s.days_left} day{s.days_left === 1 ? '' : 's'} left</div>}
                      </td>
                      <td className="small">
                        {s.agent_payment_ref && <div>Agent's UPI ref: <b>{s.agent_payment_ref}</b></div>}
                        {s.payments.length ? <div className="muted">Paid {rupees(s.total_paid)} in {s.payments.length} payment{s.payments.length > 1 ? 's' : ''}</div> : !s.agent_payment_ref && <span className="muted">—</span>}
                      </td>
                      <td className="nowrap">
                        <button className="btn btn-primary btn-sm" onClick={() => setActivating(s)}>
                          {s.state === 'active' || s.state === 'expiring' ? '↻ Renew / extend' : '✓ Activate'}
                        </button>{' '}
                        {(s.state === 'requested' || s.pending_renewal) && <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'reject')}>Reject</button>}
                        {(s.state === 'active' || s.state === 'expiring') && !s.pending_renewal && <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'stop')}>Stop</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && (
              <p className="muted panel-pad">
                {tab === 'requests' ? 'No requests right now.' : tab === 'expiring' ? 'Nobody is ending in the next 5 days.' : 'Nothing here.'}
                {!subServices.length && ' No service is subscription-only yet — turn one on in “Subscription services”.'}
              </p>
            )}
          </div>
        </section>
      )}

      {activating && (
        <ActivateForm
          sub={activating}
          agents={d?.agents || []}
          services={subServices}
          onClose={() => setActivating(null)}
          onDone={(msg) => {
            setActivating(null);
            toast(msg);
            data.reload();
          }}
        />
      )}
    </div>
  );
}

// Payment received → activate or extend. With no subscription row (sub = {}) it adds a member directly.
function ActivateForm({ sub, agents, services, onClose, onDone }) {
  const isNew = !sub.id;
  const firstSvc = services.find((s) => s.id === sub.service_id) || services[0];
  const [form, setForm] = useState({
    agent_id: sub.agent_id ?? '',
    service_id: sub.service_id ?? firstSvc?.id ?? '',
    amount: String(sub.fee ?? firstSvc?.subscription_fee ?? 0),
    mode: 'upi',
    reference: sub.agent_payment_ref || '',
    days: String(sub.days ?? firstSvc?.subscription_days ?? 30),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const pickService = (e) => {
    const s = services.find((x) => x.id === Number(e.target.value));
    setForm({ ...form, service_id: s.id, amount: String(s.subscription_fee), days: String(s.subscription_days) });
  };
  const running = sub.state === 'active' || sub.state === 'expiring';
  const from = running ? new Date(sub.paid_until) : new Date();
  const until = new Date(from.getTime() + (Number(form.days) || 0) * 86400000);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form, amount: form.mode === 'free' ? 0 : form.amount };
      if (isNew) await api('/admin/subscriptions', { method: 'POST', body });
      else await api(`/admin/subscriptions/${sub.id}/activate`, { method: 'POST', body });
      onDone(`Active until ${day(until)}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add subscription member' : `${running ? 'Renew' : 'Activate'} — ${sub.agent_name}`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="sub-form" disabled={busy}>{busy ? 'Saving…' : running ? 'Extend' : 'Activate'}</button>
      </>}
    >
      <form id="sub-form" className="stack" onSubmit={save}>
        {isNew ? (
          <>
            <label>Agent *
              <select value={form.agent_id} onChange={set('agent_id')} required>
                <option value="">Choose agent…</option>
                {agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name} · {a.phone}</option>)}
              </select>
            </label>
            <label>Service *
              <select value={form.service_id} onChange={pickService}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        ) : (
          <p className="muted small">
            {sub.service_name} · {sub.agent_phone}
            {running && <> · now active until <b>{day(sub.paid_until)}</b> (the new days are added after that)</>}
          </p>
        )}
        <div className="form-row">
          <label>Paid by
            <select value={form.mode} onChange={set('mode')}>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
              <option value="free">Free (no payment)</option>
            </select>
          </label>
          {form.mode !== 'free' && (
            <label>Amount received (₹) *
              <input type="number" min="0" step="1" value={form.amount} onChange={set('amount')} required />
            </label>
          )}
        </div>
        <div className="form-row">
          {form.mode !== 'free' && (
            <label>UPI ref / receipt no.
              <input value={form.reference} onChange={set('reference')} maxLength={60} placeholder="optional" />
            </label>
          )}
          <label>Days *
            <input type="number" min="1" max="366" value={form.days} onChange={set('days')} required />
          </label>
        </div>
        <p className="small">Active until <b>{day(until)}</b>. The agent also gets this type of work.</p>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// Which services are subscription-only, their fee and period.
function ServiceSettings({ services, onSaved }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState({}); // id → {fee, days}
  const shown = services.filter((s) => s.subscription_required || (q && `${s.name} ${s.category_name} ${s.skill_name}`.toLowerCase().includes(q.toLowerCase())));
  const val = (s, k) => edit[s.id]?.[k] ?? String(k === 'fee' ? Number(s.subscription_fee) : s.subscription_days);
  const change = (s, k) => (e) => setEdit({ ...edit, [s.id]: { ...edit[s.id], [k]: e.target.value } });

  const save = async (s, required) => {
    if (!required && s.members && !confirm(`${s.members} agent(s) have an active ${s.name} subscription. Turn it off? Then all ${s.skill_name} agents get these orders again (subscriptions are kept).`)) return;
    try {
      await api(`/admin/subscriptions/services/${s.id}`, { method: 'PUT', body: { required, fee: val(s, 'fee'), days: val(s, 'days') } });
      setEdit({ ...edit, [s.id]: undefined });
      toast(required ? `${s.name}: subscription on` : `${s.name}: subscription off`);
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <section className="panel table-panel">
      <div className="panel-pad">
        <input className="toolbar-search" type="search" placeholder="Search a service to make it subscription-only (e.g. plumber)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Service</th><th>Agent type</th><th>Subscription only</th><th>Fee (₹)</th><th>Days</th><th>Members</th><th aria-label="Save" /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                <td><b>{s.name}</b><div className="muted small">{s.icon} {s.category_name}</div></td>
                <td>{s.skill_name}</td>
                <td><Switch checked={s.subscription_required} onChange={(on) => save(s, on)} label="" /></td>
                <td><input type="number" min="0" style={{ width: 90 }} value={val(s, 'fee')} onChange={change(s, 'fee')} /></td>
                <td><input type="number" min="1" max="366" style={{ width: 70 }} value={val(s, 'days')} onChange={change(s, 'days')} /></td>
                <td>{s.subscription_required ? s.members : '—'}</td>
                <td>{edit[s.id] && <button className="btn btn-primary btn-sm" onClick={() => save(s, s.subscription_required)}>Save</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="muted panel-pad">No subscription services yet. Search a service above (e.g. “plumber”) and switch it on.</p>}
      </div>
    </section>
  );
}
