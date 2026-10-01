import { useState } from 'react';
import { api } from '../api.js';
import { Stars } from '../components/RateOrder.jsx';
import { useLoad, timeAgo } from './ui.jsx';

// Customer ratings of agents. "Agents to watch" lists low averages and fresh 1–2 ⭐ ratings so problems are seen early.
const FILTERS = [['', 'All'], ['low', '1–2 ⭐'], ['3', '3 ⭐'], ['4', '4 ⭐'], ['5', '5 ⭐']];

export default function Ratings() {
  const [stars, setStars] = useState('');
  const data = useLoad(() => api(`/admin/ratings${stars ? `?stars=${stars}` : ''}`), [stars]);
  const d = data.data;
  const s = d?.summary;

  return (
    <div className="stack">
      {s && (
        <div className="kpi-grid">
          <div className="kpi"><span className="kpi-label">Average rating</span><span className="kpi-value">{s.avg ?? '—'} <Stars value={Number(s.avg) || 0} size="sm" /></span></div>
          <div className="kpi"><span className="kpi-label">Ratings</span><span className="kpi-value">{s.count}</span><small className="muted">{s.delivered ? `${Math.round((s.count / s.delivered) * 100)}% of delivered orders` : ''}</small></div>
          <div className="kpi"><span className="kpi-label">Last 7 days</span><span className="kpi-value">{s.count_7d}</span></div>
          <div className="kpi"><span className="kpi-label">1–2 ⭐ in 7 days</span><span className="kpi-value" style={{ color: s.low_7d ? '#dc2626' : undefined }}>{s.low_7d}</span></div>
        </div>
      )}

      {d?.watchlist?.length > 0 && (
        <section className="panel watch-panel">
          <h3>⚠️ Agents to watch</h3>
          <p className="muted small">Average below 3.5 (3+ ratings) or a 1–2 ⭐ rating in the last 7 days. Call them, or suspend them in Manage agents.</p>
          <div className="watch-list">
            {d.watchlist.map((w) => (
              <div key={w.agent_id} className="watch-row">
                <b>{w.agent_name}</b>
                <span><Stars value={Number(w.avg)} size="sm" /> {w.avg} · {w.count} rating{w.count > 1 ? 's' : ''}</span>
                {w.recent_low > 0 && <span className="rate-chip bad">{w.recent_low} low this week</span>}
                <a className="link" href={`tel:${w.agent_phone}`}>📞 {w.agent_phone}</a>
                <button className="link-btn" onClick={() => setStars('low')}>See low ratings</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="tabs scroll-tabs" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={stars === k} className={stars === k ? 'active' : ''} onClick={() => setStars(k)}>{label}</button>
        ))}
      </div>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Rating</th><th>Agent</th><th>Customer</th><th>Comment</th><th>Order</th><th>When</th></tr></thead>
            <tbody>
              {(d?.ratings || []).map((r) => (
                <tr key={r.order_id} className={r.stars <= 2 ? 'row-bad' : ''}>
                  <td className="nowrap"><Stars value={r.stars} size="sm" /></td>
                  <td>{r.agent_name || <span className="muted">—</span>}</td>
                  <td>{r.customer_name}<div className="muted small">{r.customer_phone}</div></td>
                  <td className="small">
                    {r.tags?.length > 0 && <div className="rate-tags">{r.tags.map((t) => <span key={t} className="tag-pill">{t}</span>)}</div>}
                    {r.comment || (!r.tags?.length && <span className="muted">—</span>)}
                  </td>
                  <td>#{r.order_id}</td>
                  <td className="muted small nowrap">{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && !d.ratings.length && <p className="muted panel-pad">No ratings {stars ? 'with this filter ' : ''}yet. Customers can rate after an order is delivered.</p>}
          {data.loading && !d && <div className="center-block"><div className="spinner" /></div>}
          {data.error && <div className="alert">{data.error}</div>}
        </div>
      </section>
    </div>
  );
}
