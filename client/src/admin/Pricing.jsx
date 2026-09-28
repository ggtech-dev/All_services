import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { timeAgo, useLoad, useToast } from './ui.jsx';

// Mirrors sp_bulk_update_prices so the preview matches what the database will do.
const newPrice = (price, percent, roundTo) =>
  Math.max(roundTo, Math.round((price * (1 + percent / 100)) / roundTo) * roundTo);

export default function Pricing() {
  const toast = useToast();
  const cats = useLoad(() => api('/admin/categories'));
  const services = useLoad(() => api('/admin/services'));
  const history = useLoad(() => api('/admin/prices/history'));
  const [form, setForm] = useState({ categoryId: '', percent: 10, roundTo: 1 });
  const [busy, setBusy] = useState(false);

  const percent = Number(form.percent);
  const roundTo = Math.max(1, Number(form.roundTo) || 1);
  const affected = useMemo(
    () =>
      (services.data || []).filter(
        (s) => Number(s.base_price) > 0 && (!form.categoryId || s.category_id === Number(form.categoryId))
      ),
    [services.data, form.categoryId]
  );
  const valid = percent && percent >= -90 && percent <= 500;
  const scope = form.categoryId ? cats.data?.find((c) => c.id === Number(form.categoryId))?.name : 'all categories';

  const apply = async () => {
    if (!confirm(`${percent > 0 ? 'Increase' : 'Decrease'} ${affected.length} prices in ${scope} by ${Math.abs(percent)}%?`)) return;
    setBusy(true);
    try {
      const { updated } = await api('/admin/prices/bulk', { method: 'POST', body: { ...form, roundTo } });
      toast(`Updated ${updated} prices`);
      services.reload();
      history.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>📈 Bulk price change</h3>
        </div>
        <p className="muted">Raise or lower prices by a percentage. Free services (₹0) stay free. Every change is saved in the price history below.</p>
        <div className="bulk-form">
          <label>
            Apply to
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">All categories</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </label>
          <label>
            Change by (%)
            <input type="number" step="any" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          </label>
          <label>
            Round to nearest ₹
            <select value={form.roundTo} onChange={(e) => setForm({ ...form, roundTo: e.target.value })}>
              {[1, 5, 9, 10, 50, 100].map((r) => <option key={r} value={r}>₹{r}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" disabled={!valid || busy || !affected.length} onClick={apply}>
            {busy ? 'Applying…' : `Apply to ${affected.length} services`}
          </button>
        </div>
        {!valid && <small className="error-text">Enter a percentage between -90 and 500 (not 0).</small>}

        {valid && affected.length > 0 && (
          <div className="preview">
            <div className="preview-title">Preview</div>
            <div className="table-scroll">
              <table className="table compact">
                <thead><tr><th>Service</th><th>Now</th><th>After</th></tr></thead>
                <tbody>
                  {affected.slice(0, 8).map((s) => {
                    const after = newPrice(Number(s.base_price), percent, roundTo);
                    return (
                      <tr key={s.id}>
                        <td>{s.category_icon} {s.name}</td>
                        <td>₹{Number(s.base_price).toLocaleString('en-IN')}</td>
                        <td className={after > s.base_price ? 'up' : 'down'}>₹{after.toLocaleString('en-IN')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {affected.length > 8 && <small className="muted">…and {affected.length - 8} more</small>}
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-head"><h3>🕘 Price history</h3></div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Service</th><th>Old</th><th>New</th><th>Change</th><th>By</th><th>When</th></tr></thead>
            <tbody>
              {history.data?.map((h) => {
                const diff = h.old_price > 0 ? ((h.new_price - h.old_price) / h.old_price) * 100 : null;
                return (
                  <tr key={h.id}>
                    <td>{h.category_icon} {h.service_name}</td>
                    <td>₹{Number(h.old_price).toLocaleString('en-IN')} <small className="muted">{h.old_unit !== h.new_unit && h.old_unit}</small></td>
                    <td>₹{Number(h.new_price).toLocaleString('en-IN')} <small className="muted">{h.old_unit !== h.new_unit && h.new_unit}</small></td>
                    <td className={diff > 0 ? 'up' : diff < 0 ? 'down' : ''}>{diff === null ? '—' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(diff).toFixed(1)}%`}</td>
                    <td>{h.changed_by_name || 'system'}</td>
                    <td className="nowrap muted">{timeAgo(h.changed_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {history.data && !history.data.length && <p className="empty">No price changes yet.</p>}
        </div>
      </section>
    </div>
  );
}
