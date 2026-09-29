import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiFile } from '../api.js';
import { AGENT_STATE, rupees } from '../orderStatus.jsx';
import { useLoad } from './ui.jsx';

// ---------- dates (the admin is in India, so local dates = IST) ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => new Date();
const PRESETS = {
  today: { label: 'Today', range: () => [today(), today()] },
  yesterday: { label: 'Yesterday', range: () => [addDays(today(), -1), addDays(today(), -1)] },
  d7: { label: 'Last 7 days', range: () => [addDays(today(), -6), today()] },
  d30: { label: 'Last 30 days', range: () => [addDays(today(), -29), today()] },
  month: { label: 'This month', range: () => [new Date(today().getFullYear(), today().getMonth(), 1), today()] },
  last_month: {
    label: 'Last month',
    range: () => [new Date(today().getFullYear(), today().getMonth() - 1, 1), new Date(today().getFullYear(), today().getMonth(), 0)],
  },
};
const shortDay = (s) => new Date(`${s}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const n = (v) => Number(v || 0).toLocaleString('en-IN');

// ---------- CSV (client side, for the tables) ----------
function downloadCsv(filename, columns, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [preset, setPreset] = useState('d7');
  const [custom, setCustom] = useState(() => ({ from: iso(addDays(today(), -6)), to: iso(today()) }));
  const [from, to] = preset === 'custom' ? [custom.from, custom.to] : PRESETS[preset].range().map(iso);
  const report = useLoad(() => api(`/admin/reports?from=${from}&to=${to}`), [from, to]);
  const r = report.data;
  const tag = `${from}_to_${to}`;

  const downloadOrders = async () => {
    const f = await apiFile(`/admin/reports/orders.csv?from=${from}&to=${to}`);
    const a = Object.assign(document.createElement('a'), { href: f.url, download: `orders_${tag}.csv` });
    a.click();
    URL.revokeObjectURL(f.url);
  };

  return (
    <div className="stack reports">
      <div className="report-filters">
        <div className="tabs scroll-tabs" role="tablist" aria-label="Date range">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} role="tab" aria-selected={preset === k} className={preset === k ? 'active' : ''} onClick={() => setPreset(k)}>{p.label}</button>
          ))}
          <button role="tab" aria-selected={preset === 'custom'} className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>Custom</button>
        </div>
        {preset === 'custom' && (
          <div className="custom-range">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span>to</span>
            <input type="date" value={custom.to} min={custom.from} max={iso(today())} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={downloadOrders}>⬇ Download all orders (CSV)</button>
      </div>

      {report.error && <div className="alert">{report.error}</div>}
      {!r ? (
        <div className="center-block"><div className="spinner" /></div>
      ) : (
        <>
          <p className="muted small range-note">
            {shortDay(r.from)}{r.from !== r.to && ` – ${shortDay(r.to)}`} · {r.days} day{r.days > 1 ? 's' : ''} · compared with the {r.days} day{r.days > 1 ? 's' : ''} before
          </p>
          <Kpis k={r.kpis} prev={r.previous} />

          <div className="chart-grid">
            <ChartPanel title="Orders per day" subtitle="all orders placed">
              <BarChart
                data={r.by_day.map((d) => ({ label: shortDay(d.day), value: d.orders, tip: [`${shortDay(d.day)}`, `${d.orders} orders`, `${d.delivered} delivered · ${d.cancelled} cancelled`] }))}
              />
            </ChartPanel>
            <ChartPanel title="Revenue per day" subtitle="delivered orders, ₹">
              <BarChart
                data={r.by_day.map((d) => ({ label: shortDay(d.day), value: Number(d.revenue), tip: [shortDay(d.day), rupees(d.revenue), `${d.delivered} delivered`] }))}
                format={(v) => `₹${v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}`}
              />
            </ChartPanel>
            <ChartPanel title="Busy hours" subtitle="orders by hour of day">
              <BarChart
                data={r.by_hour.map((h) => ({ label: `${h.hour}`, value: h.orders, tip: [`${h.hour}:00 – ${h.hour}:59`, `${h.orders} orders`] }))}
                labelEvery={3}
              />
            </ChartPanel>
          </div>

          <AgentTable rows={r.agents} tag={tag} />

          <div className="report-grid">
            <BreakdownTable
              title="By agent type"
              rows={r.by_type}
              columns={[
                { key: 'name', label: 'Type', render: (x) => `${x.icon} ${x.name}` },
                { key: 'orders', label: 'Orders', num: true, bar: true },
                { key: 'delivered', label: 'Delivered', num: true },
                { key: 'revenue', label: 'Revenue', num: true, money: true },
              ]}
              file={`by_type_${tag}.csv`}
            />
            <BreakdownTable
              title="By category"
              rows={r.by_category}
              columns={[
                { key: 'name', label: 'Category', render: (x) => `${x.icon} ${x.name}` },
                { key: 'orders', label: 'Orders', num: true, bar: true },
                { key: 'revenue', label: 'Revenue', num: true, money: true },
              ]}
              file={`by_category_${tag}.csv`}
            />
            <BreakdownTable
              title="Top areas"
              rows={r.by_area}
              columns={[
                { key: 'name', label: 'Area' },
                { key: 'orders', label: 'Orders', num: true, bar: true },
                { key: 'delivered', label: 'Delivered', num: true },
                { key: 'revenue', label: 'Revenue', num: true, money: true },
              ]}
              file={`by_area_${tag}.csv`}
            />
            <BreakdownTable
              title="Top selling items"
              rows={r.top_items}
              columns={[
                { key: 'name', label: 'Item', render: (x) => <>{x.name} <small className="muted">{x.unit}</small></> },
                { key: 'qty', label: 'Qty sold', num: true, bar: true },
                { key: 'revenue', label: 'Sales', num: true, money: true },
              ]}
              file={`top_items_${tag}.csv`}
            />
            <BreakdownTable
              title="Top customers"
              rows={r.top_customers}
              columns={[
                { key: 'name', label: 'Customer', render: (x) => <Link className="link" to={`/admin/orders?customer=${x.id}`}>{x.name}</Link>, csv: (x) => x.name },
                { key: 'phone', label: 'Phone' },
                { key: 'orders', label: 'Orders', num: true },
                { key: 'spent', label: 'Spent', num: true, money: true, bar: true },
              ]}
              file={`top_customers_${tag}.csv`}
            />
            <BreakdownTable
              title="Why orders were cancelled"
              rows={r.cancel_reasons}
              empty="No cancellations in this period 🎉"
              columns={[
                { key: 'reason', label: 'Reason' },
                { key: 'n', label: 'Orders', num: true, bar: true },
              ]}
              file={`cancellations_${tag}.csv`}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ---------- headline numbers ----------
function Kpis({ k, prev }) {
  const tiles = [
    { label: 'Orders', value: n(k.orders), cur: k.orders, prev: prev.orders, good: 'up', sub: `${n(k.in_progress)} in progress now` },
    { label: 'Delivered', value: n(k.delivered), cur: k.delivered, prev: prev.delivered, good: 'up', sub: k.orders ? `${Math.round((k.delivered / k.orders) * 100)}% of orders` : '—' },
    { label: 'Revenue', value: rupees(k.revenue), cur: Number(k.revenue), prev: Number(prev.revenue), good: 'up', sub: `${rupees(k.delivery_fees)} delivery fees` },
    { label: 'Avg. order value', value: k.avg_order_value != null ? rupees(k.avg_order_value) : '—', cur: k.avg_order_value, prev: prev.avg_order_value, good: 'up', sub: 'delivered orders' },
    { label: 'Avg. time to deliver', value: k.avg_minutes != null ? `${k.avg_minutes} min` : '—', cur: k.avg_minutes, prev: prev.avg_minutes, good: 'down', sub: 'order placed → delivered' },
    { label: 'Cancelled', value: n(k.cancelled), cur: k.cancelled, prev: prev.cancelled, good: 'down', sub: k.orders ? `${Math.round((k.cancelled / k.orders) * 100)}% of orders` : '—' },
    { label: 'Customers ordering', value: n(k.customers), cur: k.customers, prev: prev.customers, good: 'up', sub: `${n(k.new_customers)} new sign-ups` },
    { label: 'Agent pay', value: rupees(k.agent_pay), cur: Number(k.agent_pay), prev: Number(prev.agent_pay), good: null, sub: `${n(k.active_agents)} agents delivered` },
  ];
  return (
    <div className="kpi-grid">
      {tiles.map((t) => (
        <div key={t.label} className="kpi">
          <span className="kpi-label">{t.label}</span>
          <b className="kpi-value">{t.value}</b>
          <Delta cur={t.cur} prev={t.prev} good={t.good} />
          <small className="muted">{t.sub}</small>
        </div>
      ))}
    </div>
  );
}

function Delta({ cur, prev, good }) {
  if (cur == null || prev == null) return <span className="delta muted">—</span>;
  const c = Number(cur);
  const p = Number(prev);
  if (p === 0) return <span className="delta muted">{c === 0 ? 'same as before' : 'new vs before'}</span>;
  const pct = Math.round(((c - p) / p) * 100);
  if (pct === 0) return <span className="delta muted">same as before</span>;
  const up = pct > 0;
  const tone = good == null ? '' : (up === (good === 'up') ? 'delta-good' : 'delta-bad');
  return <span className={`delta ${tone}`}>{up ? '▲' : '▼'} {Math.abs(pct)}% <span className="muted">vs before</span></span>;
}

// ---------- single-series bar chart (SVG, one hue, hover tooltip) ----------
function ChartPanel({ title, subtitle, children }) {
  return (
    <section className="panel chart-panel">
      <div className="chart-head"><h3>{title}</h3><small className="muted">{subtitle}</small></div>
      {children}
    </section>
  );
}

function BarChart({ data, format = (v) => n(v), labelEvery }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const H = 240;
  const pad = { l: 58, r: 8, t: 12, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.value), 0);
  // round the axis max up to a nice number
  const niceMax = useMemo(() => {
    if (max <= 0) return 4;
    const pow = 10 ** Math.floor(Math.log10(max));
    return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= max);
  }, [max]);
  const ticks = [0, niceMax / 2, niceMax];
  const slot = innerW / data.length;
  const gap = Math.min(2 + slot * 0.2, 10);
  const bw = Math.max(slot - gap, 2);
  const every = labelEvery || Math.ceil(data.length / 6);
  const y = (v) => pad.t + innerH - (v / niceMax) * innerH;

  // bar with 4px rounded top, flat on the baseline
  const barPath = (x, top, w) => {
    const h = pad.t + innerH - top;
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M${x},${pad.t + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${pad.t + innerH} Z`;
  };

  const allZero = max === 0;
  return (
    <div className="bar-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-line' : 'grid-line'} />
            <text x={pad.l - 6} y={y(t) + 4} className="axis-text" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + gap / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              {/* invisible full-height hit area, bigger than the bar */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={innerH} className="hit" />
              <path d={barPath(x, y(d.value), bw)} className={`bar ${hover === i ? 'bar-hover' : ''}`} />
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} className="axis-text" textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {allZero && <div className="chart-empty muted small">No orders in this period yet</div>}
      {hover != null && !allZero && (
        <div className="chart-tip" style={{ left: `${((pad.l + (hover + 0.5) * slot) / W) * 100}%` }}>
          {data[hover].tip.map((line, j) => (j === 0 ? <b key={j}>{line}</b> : <div key={j}>{line}</div>))}
        </div>
      )}
    </div>
  );
}

// ---------- tables ----------
function BreakdownTable({ title, rows, columns, file, empty = 'No data in this period' }) {
  const barCol = columns.find((c) => c.bar);
  const max = barCol ? Math.max(1, ...rows.map((r) => Number(r[barCol.key]) || 0)) : 1;
  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {rows.length > 0 && (
          <button className="link-btn" onClick={() => downloadCsv(file, columns, rows.map((r) => ({ ...r })))} title="Download CSV">⬇ CSV</button>
        )}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="table compact">
            <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : ''}>
                      {c.bar ? (
                        <div className="cell-bar">
                          <span className="cell-bar-fill" style={{ width: `${(Number(r[c.key]) / max) * 100}%` }} />
                          <span>{c.money ? rupees(r[c.key]) : n(r[c.key])}</span>
                        </div>
                      ) : c.render ? c.render(r) : c.money ? rupees(r[c.key]) : c.num ? n(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
}

const AGENT_COLS = [
  { key: 'name', label: 'Agent' },
  { key: 'phone', label: 'Phone' },
  { key: 'state', label: 'Now', csv: (a) => AGENT_STATE[a.state]?.label || a.state },
  { key: 'delivered', label: 'Delivered', num: true },
  { key: 'in_progress', label: 'In progress', num: true },
  { key: 'released', label: 'Released', num: true },
  { key: 'avg_minutes', label: 'Avg. min', num: true },
  { key: 'order_value', label: 'Order value ₹', num: true },
  { key: 'earnings', label: 'Earned ₹', num: true },
  { key: 'cash_in_hand', label: 'Cash in hand ₹', num: true },
];

function AgentTable({ rows, tag }) {
  const [sort, setSort] = useState({ key: 'delivered', dir: -1 });
  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key] ?? -1;
    const vb = b[sort.key] ?? -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb)) * sort.dir;
  });
  const max = Math.max(1, ...rows.map((r) => Number(r.delivered)));
  const th = (c) => (
    <th key={c.key} className={`sortable ${c.num ? 'num' : ''}`} onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : -1 })}>
      {c.label} {sort.key === c.key ? (sort.dir < 0 ? '▼' : '▲') : ''}
    </th>
  );
  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h3>🛵 Agent performance <span className="muted small">· click a column to sort</span></h3>
        <button className="link-btn" onClick={() => downloadCsv(`agents_${tag}.csv`, AGENT_COLS, sorted)}>⬇ CSV</button>
      </div>
      <div className="table-scroll">
        <table className="table compact">
          <thead><tr>{AGENT_COLS.filter((c) => c.key !== 'phone').map(th)}</tr></thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.user_id}>
                <td>
                  <Link className="link" to={`/admin/agents?open=${a.user_id}`}>{a.name}</Link>
                  <div className="muted small">{a.phone}</div>
                </td>
                <td><span className="status-badge" style={{ '--c': AGENT_STATE[a.state]?.color }}>{AGENT_STATE[a.state]?.label}</span></td>
                <td className="num">
                  <div className="cell-bar"><span className="cell-bar-fill" style={{ width: `${(a.delivered / max) * 100}%` }} /><span>{n(a.delivered)}</span></div>
                </td>
                <td className="num">{n(a.in_progress)}</td>
                <td className="num">{n(a.released)}</td>
                <td className="num">{a.avg_minutes != null ? a.avg_minutes : '—'}</td>
                <td className="num">{rupees(a.order_value)}</td>
                <td className="num">{rupees(a.earnings)}</td>
                <td className={`num ${Number(a.cash_in_hand) > 0 ? 'cash-due' : ''}`}>{rupees(a.cash_in_hand)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">No agents yet.</p>}
      </div>
    </section>
  );
}
