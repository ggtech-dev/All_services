import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../api.js';
import { Modal, timeAgo, useLoad, useToast } from './ui.jsx';
import { StateBadge, StatusBadge, VEHICLES, rupees, usePoll, when } from '../orderStatus.jsx';
import { AGENT_DOCS, AgentForm, SkillPicker } from '../pages/AgentApply.jsx';
import MapView, { secondsAgo } from '../components/MapView.jsx';
import { Stars } from '../components/RateOrder.jsx';

const TABS = [
  ['', 'All agents'],
  ['free', '🟢 Free now'],
  ['busy', '🔵 On delivery'],
  ['offline', '⚪ Offline'],
  ['pending', '📝 Applications'],
  ['suspended', 'Suspended'],
  ['rejected', 'Rejected'],
];

export default function Agents() {
  const toast = useToast();
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const [skill, setSkill] = useState(params.get('skill') || '');
  useEffect(() => {
    // Links from the live map / elsewhere: /admin/agents?open=<agent id>
    if (params.get('open')) setOpenId(Number(params.get('open')));
  }, [params]);
  const all = useLoad(() => api('/admin/agents'));
  const types = useLoad(() => api('/service-types'));
  const typeOf = (code) => types.data?.find((t) => t.code === code);

  const inSkill = (a) => !skill || a.skills.includes(skill);
  const count = (state) => (all.data || []).filter((a) => inSkill(a) && (!state || a.state === state)).length;
  const rows = (all.data || []).filter(
    (a) => inSkill(a) && (!tab || a.state === tab) && (!q || `${a.full_name} ${a.phone} ${a.username} ${a.locality_name || ''}`.toLowerCase().includes(q.toLowerCase()))
  );
  const applyLink = `${window.location.origin}/agent/apply`;

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="tabs scroll-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label} <span className={`count ${k === 'pending' && count('pending') ? 'alert-count' : ''}`}>{count(k)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <input className="toolbar-search" placeholder="🔍 Name, phone, username or area…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Type of work">
          <option value="">All types of work</option>
          {types.data?.map((t) => <option key={t.code} value={t.code}>{t.icon} {t.name}</option>)}
        </select>
        <button
          className="btn btn-ghost"
          onClick={() => navigator.clipboard?.writeText(applyLink).then(() => toast('Application link copied — share it on WhatsApp'), () => prompt('Copy this link:', applyLink))}
        >
          🔗 Copy apply link
        </button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>➕ Add agent</button>
      </div>

      {tab === 'pending' ? (
        <div className="app-grid">
          {!rows.length && <p className="empty panel">No applications waiting. Share the apply link to get new agents.</p>}
          {rows.map((a) => (
            <article key={a.user_id} className="panel app-card">
              <div className="app-top">
                <div className="agent-avatar">{a.full_name[0]}</div>
                <div>
                  <b>{a.full_name}</b>
                  <div className="muted small">{a.phone} · {VEHICLES[a.vehicle_type]} · {a.locality_name || 'area not set'}</div>
                  <div className="chip-row">{a.skills.map((c) => <span key={c} className="skill-chip small">{typeOf(c)?.icon} {typeOf(c)?.name || c}</span>)}</div>
                  <div className="muted small">Applied {when(a.created_at)}</div>
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setOpenId(a.user_id)}>Review documents →</button>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Agent</th><th>Types of work</th><th>Status</th><th>Area</th><th>Today</th><th>Total</th><th>Rating</th><th>Wallet</th><th>Cash in hand</th><th aria-label="Open" /></tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.user_id} className="clickable" onClick={() => setOpenId(a.user_id)}>
                    <td>
                      <div className="cell-service">
                        <div className="agent-avatar small">{a.full_name[0]}</div>
                        <div><b>{a.full_name}</b><div className="muted small">{a.phone} · {VEHICLES[a.vehicle_type]}</div></div>
                      </div>
                    </td>
                    <td><div className="chip-row">{a.skills.map((c) => <span key={c} className="skill-chip small" title={typeOf(c)?.name}>{typeOf(c)?.icon} {typeOf(c)?.name || c}</span>)}</div></td>
                    <td>
                      <StateBadge state={a.state} />
                      {a.last_seen_at && a.state === 'offline' && <div className="muted small">seen {timeAgo(a.last_seen_at)}</div>}
                    </td>
                    <td>{a.locality_name || <span className="muted">—</span>}</td>
                    <td className="nowrap"><b>{a.today_deliveries}</b> <span className="muted small">deliveries</span></td>
                    <td>{a.total_deliveries}</td>
                    <td className={`nowrap ${a.rating?.count >= 3 && Number(a.rating.avg) < 3.5 ? 'rating-bad' : ''}`}>
                      {a.rating?.count ? <>★ {a.rating.avg} <span className="muted small">({a.rating.count})</span></> : <span className="muted">—</span>}
                    </td>
                    <td className="nowrap">{rupees(a.wallet_balance)}</td>
                    <td className={`nowrap ${Number(a.cash_in_hand) > 0 ? 'cash-due' : ''}`}>{rupees(a.cash_in_hand)}</td>
                    <td><button className="btn btn-ghost btn-sm">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {all.loading && !all.data && <div className="center-block"><div className="spinner" /></div>}
            {all.data && !rows.length && <p className="empty">No agents here.</p>}
          </div>
        </section>
      )}

      {adding && (
        <Modal title="Add a delivery agent" onClose={() => setAdding(false)} wide>
          <p className="muted small">Agents you add here are active straight away. Documents are optional here, but recommended.</p>
          <AgentForm
            docsRequired={false}
            submitLabel="Add agent"
            onSubmit={async (fd) => {
              await api('/admin/agents', { method: 'POST', body: fd });
              setAdding(false);
              toast('Agent added. They can log in with the Agent tab now.');
              all.reload();
            }}
          />
        </Modal>
      )}
      {openId && <AgentDetail id={openId} types={types.data || []} onClose={() => setOpenId(null)} onChanged={all.reload} />}
    </div>
  );
}

function DocThumb({ agentId, field, label }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let url;
    apiFile(`/admin/agents/${agentId}/docs/${field}`)
      .then((f) => {
        url = f.url;
        setFile(f);
      })
      .catch((e) => setError(e.message));
    return () => url && URL.revokeObjectURL(url);
  }, [agentId, field]);

  return (
    <a className="doc-thumb" href={file?.url} target="_blank" rel="noreferrer" onClick={(e) => !file && e.preventDefault()}>
      {file?.type.startsWith('image/') ? <img src={file.url} alt={label} /> : <span>{error ? '⚠️' : file ? '📄 PDF' : '…'}</span>}
      <small>{label}</small>
    </a>
  );
}

// Where the agent is now + their path over the last 12 hours.
function AgentLocation({ agent }) {
  const [track, setTrack] = useState(null);
  const [pos, setPos] = useState(null);
  const load = useCallback(() => {
    api(`/admin/agents/${agent.user_id}/track`).then(setTrack).catch(() => {});
    api('/admin/live').then((all) => setPos(all.find((x) => x.user_id === agent.user_id) || null)).catch(() => {});
  }, [agent.user_id]);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 10000);

  if (!track) return null;
  if (!pos) {
    return <section className="loc-empty"><h4>Live location</h4><p className="muted small">No GPS yet. The agent's location appears here when they go online in the agent app and allow location access.</p></section>;
  }
  const markers = [{ id: 'me', lat: pos.lat, lng: pos.lng, emoji: '🛵', color: '#4f46e5', pulse: true, accuracy_m: pos.accuracy_m, label: `${agent.full_name} · ${secondsAgo(pos.age_seconds)}` }];
  if (track.order) markers.push({ id: 'dest', lat: track.order.dest_lat, lng: track.order.dest_lng, emoji: '🏠', color: '#16a34a', label: `Order #${track.order.id}` });
  return (
    <section>
      <div className="panel-head">
        <h4>Live location <span className="muted small">· updated {secondsAgo(pos.age_seconds)}{track.order && ` · order #${track.order.id} is ${track.order.distance_km} km away (~${track.order.eta_minutes} min)`}</span></h4>
        <Link className="link" to="/admin/live">Open live map →</Link>
      </div>
      <MapView markers={markers} path={track.trail.map((p) => [p.lat, p.lng])} fitKey={agent.user_id} height={260} />
    </section>
  );
}

const WALLET_ACTIONS = {
  payout: { label: 'Pay agent', hint: 'Money you paid the agent (UPI/bank/cash)' },
  cod_deposited: { label: 'Cash received', hint: 'COD cash the agent handed over' },
  bonus: { label: 'Give bonus', hint: 'Extra earning added to their wallet' },
};

function AgentDetail({ id, types, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [skills, setSkills] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState({ type: 'payout', amount: '', note: '' });

  const saved = useRef(null); // the agent's types of work as last loaded from the server
  const load = useCallback(
    () => api(`/admin/agents/${id}`).then((d) => {
      setData(d);
      // a reload must not wipe types the admin is still choosing (unsaved edits)
      const same = (x, y) => x && y && x.slice().sort().join() === y.slice().sort().join();
      setSkills((cur) => (cur === null || same(cur, saved.current) ? d.agent.skills : cur));
      saved.current = d.agent.skills;
    }).catch((e) => toast(e.message, 'error')),
    [id, toast]
  );
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      await load();
      onChanged();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Modal title="Agent" onClose={onClose} wide><div className="center-block"><div className="spinner" /></div></Modal>;
  const { agent: a, stats: s, docs } = data;
  const max = Math.max(1, ...s.last7.map((d) => d.deliveries));

  return (
    <Modal title={a.full_name} onClose={onClose} wide>
      <div className="ad">
        <div className="ad-head">
          <div className="agent-avatar">{a.full_name[0]}</div>
          <div className="ad-who">
            <StateBadge state={a.state} />
            <div className="muted small">@{a.username} · joined {when(a.joined_at)}</div>
          </div>
          <div className="ad-actions">
            {a.status === 'pending' && (
              <>
                <button className="btn btn-primary btn-sm btn-success" disabled={busy}
                  onClick={() => act(() => api(`/admin/agents/${a.user_id}/review`, { method: 'POST', body: { approve: true } }), `${a.full_name} is now an agent`)}>
                  ✅ Approve
                </button>
                <button className="btn btn-ghost btn-sm danger-text" disabled={busy}
                  onClick={() => {
                    const reason = prompt('Reason for rejecting (the applicant sees this when they try to log in):');
                    if (reason) act(() => api(`/admin/agents/${a.user_id}/review`, { method: 'POST', body: { approve: false, reason } }), 'Application rejected');
                  }}>
                  Reject
                </button>
              </>
            )}
            {a.status === 'active' && (
              <button className="btn btn-ghost btn-sm danger-text" disabled={busy}
                onClick={() => confirm(`Suspend ${a.full_name}? They will be logged out of orders until you re-activate them.`) &&
                  act(() => api(`/admin/agents/${a.user_id}/status`, { method: 'PATCH', body: { status: 'suspended' } }), 'Agent suspended')}>
                Suspend
              </button>
            )}
            {a.status === 'suspended' && (
              <button className="btn btn-primary btn-sm" disabled={busy}
                onClick={() => act(() => api(`/admin/agents/${a.user_id}/status`, { method: 'PATCH', body: { status: 'active' } }), 'Agent re-activated')}>
                Re-activate
              </button>
            )}
          </div>
        </div>
        {a.status === 'rejected' && <div className="alert">Rejected: {a.rejection_reason}</div>}

        <section className="skills-edit">
          <h4>Types of work <span className="muted small">— this agent only sees and gets these orders</span></h4>
          <SkillPicker types={types} value={skills || []} onChange={setSkills} />
          {skills && skills.slice().sort().join() !== a.skills.slice().sort().join() && (
            <div className="skills-save">
              <button className="btn btn-primary btn-sm" disabled={busy || !skills.length}
                onClick={() => act(() => api(`/admin/agents/${a.user_id}/skills`, { method: 'PATCH', body: { skills } }), 'Types of work updated')}>
                Save types of work
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSkills(a.skills)}>Undo</button>
              {!skills.length && <small className="error-text">Choose at least one</small>}
            </div>
          )}
        </section>

        {a.status === 'active' && <AgentLocation agent={a} />}

        <div className="od-grid">
          <section>
            <h4>Details</h4>
            <dl className="kv">
              <dt>Mobile</dt><dd><a href={`tel:${a.phone}`}>{a.phone}</a></dd>
              <dt>Email</dt><dd>{a.email || '—'}</dd>
              <dt>Vehicle</dt><dd>{VEHICLES[a.vehicle_type]} {a.vehicle_number}</dd>
              <dt>Area</dt><dd>{a.locality_name || '—'}</dd>
              <dt>Aadhaar</dt><dd>{a.aadhaar_masked || '—'}</dd>
              <dt>PAN</dt><dd>{a.pan_number || '—'}</dd>
              <dt>Licence</dt><dd>{a.dl_number || '—'}</dd>
            </dl>
          </section>
          <section>
            <h4>Documents</h4>
            <div className="doc-thumbs">
              {AGENT_DOCS.filter((d) => docs[d.field]).map((d) => <DocThumb key={d.field} agentId={a.user_id} field={d.field} label={d.label} />)}
              {!AGENT_DOCS.some((d) => docs[d.field]) && <p className="muted small">No documents uploaded.</p>}
            </div>
            <small className="muted">Click a document to open it full size.</small>
          </section>
        </div>

        {a.status !== 'pending' && (
          <>
            <div className="ad-stats">
              <div><small>Today</small><b>{s.today_deliveries}</b><small>deliveries</small></div>
              <div><small>Total</small><b>{s.total_deliveries}</b><small>deliveries</small></div>
              <div><small>Avg. time</small><b>{s.avg_delivery_minutes != null ? `${s.avg_delivery_minutes}m` : '—'}</b><small>per order</small></div>
              <div><small>Wallet</small><b>{rupees(s.wallet_balance)}</b><small>to pay agent</small></div>
              <div className={Number(s.cash_in_hand) > 0 ? 'warn' : ''}><small>Cash in hand</small><b>{rupees(s.cash_in_hand)}</b><small>to collect</small></div>
              <div><small>Lifetime</small><b>{rupees(s.lifetime_earnings)}</b><small>earned</small></div>
              <div className={s.rating?.count >= 3 && Number(s.rating.avg) < 3.5 ? 'warn' : ''}><small>Rating</small><b>{s.rating?.count ? `★ ${s.rating.avg}` : '—'}</b><small>{s.rating?.count || 0} ratings{s.rating?.low ? ` · ${s.rating.low} low` : ''}</small></div>
            </div>

            {data.ratings?.length > 0 && (
              <section>
                <h4>Customer ratings</h4>
                <ul className="agent-ratings">
                  {data.ratings.slice(0, 8).map((r) => (
                    <li key={r.order_id} className={r.stars <= 2 ? 'row-bad' : ''}>
                      <Stars value={r.stars} size="sm" />
                      <span className="small">{[...(r.tags || []), r.comment].filter(Boolean).join(' · ') || <span className="muted">No comment</span>}</span>
                      <small className="muted">#{r.order_id} · {r.customer_name} · {timeAgo(r.created_at)}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="od-grid">
              <section>
                <h4>Last 7 days</h4>
                <div className="mini-chart">
                  {s.last7.map((d) => (
                    <div key={d.day} title={`${d.deliveries} deliveries · ${rupees(d.earnings)}`}>
                      <small>{d.deliveries || ''}</small>
                      <span style={{ height: `${(d.deliveries / max) * 100}%` }} />
                      <small className="muted">{new Date(d.day).toLocaleDateString('en-IN', { weekday: 'short' })}</small>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h4>Wallet</h4>
                <form className="wallet-form" onSubmit={(e) => {
                  e.preventDefault();
                  act(() => api(`/admin/agents/${a.user_id}/wallet`, { method: 'POST', body: wallet }), `${WALLET_ACTIONS[wallet.type].label}: ${rupees(wallet.amount)} saved`)
                    .then((ok) => ok && setWallet({ ...wallet, amount: '', note: '' }));
                }}>
                  <div className="seg">
                    {Object.entries(WALLET_ACTIONS).map(([k, v]) => (
                      <button type="button" key={k} className={wallet.type === k ? 'active' : ''} onClick={() => setWallet({ ...wallet, type: k })}>{v.label}</button>
                    ))}
                  </div>
                  <small className="muted">{WALLET_ACTIONS[wallet.type].hint}</small>
                  <div className="form-row">
                    <input type="number" min="1" step="any" placeholder="Amount ₹" value={wallet.amount} onChange={(e) => setWallet({ ...wallet, amount: e.target.value })} required />
                    <input placeholder="Note (e.g. UPI ref)" value={wallet.note} onChange={(e) => setWallet({ ...wallet, note: e.target.value })} />
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy || !wallet.amount}>Save</button>
                </form>
              </section>
            </div>

            <section>
              <div className="panel-head">
                <h4>Recent orders</h4>
                <Link className="link" to={`/admin/orders?agent=${a.user_id}`} onClick={onClose}>All orders →</Link>
              </div>
              <div className="table-scroll">
                <table className="table compact">
                  <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Earned</th><th>Time taken</th></tr></thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td><Link className="link" to={`/admin/orders?open=${o.id}`} onClick={onClose}>#{o.id}</Link> <span className="muted small">{when(o.created_at)}</span></td>
                        <td>{o.contact_name} <span className="muted small">{o.locality_name}</span></td>
                        <td><StatusBadge status={o.status} /></td>
                        <td>{rupees(o.total)}</td>
                        <td>{o.agent_earning ? rupees(o.agent_earning) : '—'}</td>
                        <td>{o.minutes != null ? `${o.minutes} min` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.orders.length && <p className="empty">No orders yet.</p>}
              </div>
            </section>

            <section>
              <h4>Wallet history</h4>
              <ul className="wallet-list">
                {data.wallet.map((w) => (
                  <li key={w.id}>
                    <span>{{ earning: '➕ Earning', bonus: '🎁 Bonus', payout: '💸 Paid to agent', cod_collected: '💵 COD collected', cod_deposited: '🏦 Cash received' }[w.type]}</span>
                    <span className="muted small">{w.note || (w.order_id && `#${w.order_id}`)} · {when(w.created_at)}{w.created_by_name && ` · ${w.created_by_name}`}</span>
                    <b>{rupees(w.amount)}</b>
                  </li>
                ))}
                {!data.wallet.length && <li className="muted">No wallet activity yet.</li>}
              </ul>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
