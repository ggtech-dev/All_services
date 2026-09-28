import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { timeAgo, useLoad, useToast } from './ui.jsx';
import { EMPTY_SERVICE, ServiceForm, ServicesTable, matchesFilter } from './Services.jsx';
import { EMPTY_PRODUCT, ProductForm, ProductsTable } from './Products.jsx';

// Mirrors sp_bulk_update_prices so the preview matches what the database will do.
const newPrice = (price, percent, roundTo, mrp) =>
  Math.min(mrp ? Number(mrp) : Infinity, Math.max(roundTo, Math.round((price * (1 + percent / 100)) / roundTo) * roundTo));

const TARGETS = { products: 'Products', services: 'Services', both: 'Products & services' };

export default function Pricing() {
  const toast = useToast();
  const cats = useLoad(() => api('/admin/categories'));
  const services = useLoad(() => api('/admin/services'));
  const products = useLoad(() => api('/admin/products'));
  const history = useLoad(() => api('/admin/prices/history'));
  const [tab, setTab] = useState('products');
  const [filter, setFilter] = useState({ category: '', q: '' });
  const [editing, setEditing] = useState(null); // { kind, item }

  const reloadAll = () => {
    services.reload();
    products.reload();
    history.reload();
  };

  const serviceRows = useMemo(() => (services.data || []).filter((s) => matchesFilter(s, filter)), [services.data, filter]);
  const productRows = useMemo(() => (products.data || []).filter((p) => matchesFilter(p, filter)), [products.data, filter]);

  return (
    <div className="stack">
      <BulkPanel cats={cats.data} services={services.data} products={products.data} onDone={reloadAll} toast={toast} />

      <section className="stack">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
              🛍️ Products <span className="count">{products.data?.length ?? '…'}</span>
            </button>
            <button role="tab" aria-selected={tab === 'services'} className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>
              🧰 Services <span className="count">{services.data?.length ?? '…'}</span>
            </button>
          </div>
          <input className="toolbar-search" placeholder={`🔍 Search ${tab}…`} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <button
            className="btn btn-primary"
            onClick={() =>
              setEditing(tab === 'products'
                ? { kind: 'product', item: { ...EMPTY_PRODUCT } }
                : { kind: 'service', item: { ...EMPTY_SERVICE, category_id: filter.category } })
            }
          >
            ➕ Add {tab === 'products' ? 'product' : 'service'}
          </button>
        </div>
        <p className="muted hint-line">Click any price to change it, click a photo to upload a new one. Changes go live for customers immediately.</p>

        {tab === 'products' ? (
          <ProductsTable rows={productRows} total={products.data?.length} loading={products.loading && !products.data} reload={reloadAll} onEdit={(item) => setEditing({ kind: 'product', item })} />
        ) : (
          <ServicesTable rows={serviceRows} total={services.data?.length} loading={services.loading && !services.data} reload={reloadAll} onEdit={(item) => setEditing({ kind: 'service', item })} />
        )}
      </section>

      <HistoryPanel history={history} />

      {editing?.kind === 'product' && (
        <ProductForm
          product={editing.item}
          services={services.data || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            reloadAll();
            toast(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
          }}
        />
      )}
      {editing?.kind === 'service' && (
        <ServiceForm
          service={editing.item}
          categories={cats.data || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            reloadAll();
            toast(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
          }}
        />
      )}
    </div>
  );
}

function BulkPanel({ cats, services, products, onDone, toast }) {
  const [form, setForm] = useState({ target: 'products', categoryId: '', percent: 10, roundTo: 1 });
  const [busy, setBusy] = useState(false);
  const percent = Number(form.percent);
  const roundTo = Math.max(1, Number(form.roundTo) || 1);
  const valid = percent && percent >= -90 && percent <= 500;

  const affected = useMemo(() => {
    const inCat = (catId) => !form.categoryId || catId === Number(form.categoryId);
    const svc = form.target === 'products' ? [] : (services || [])
      .filter((s) => Number(s.base_price) > 0 && inCat(s.category_id))
      .map((s) => ({ key: `s${s.id}`, icon: s.category_icon, name: s.name, unit: s.price_unit, now: Number(s.base_price), mrp: null }));
    const prd = form.target === 'services' ? [] : (products || [])
      .filter((p) => Number(p.price) > 0 && inCat(p.category_id))
      .map((p) => ({ key: `p${p.id}`, icon: p.icon || p.category_icon, name: p.name, unit: p.unit, now: Number(p.price), mrp: p.mrp }));
    return [...prd, ...svc];
  }, [services, products, form.target, form.categoryId]);

  const scope = form.categoryId ? cats?.find((c) => c.id === Number(form.categoryId))?.name : 'all categories';

  const apply = async () => {
    const verb = percent > 0 ? 'Increase' : 'Decrease';
    if (!confirm(`${verb} ${affected.length} prices (${TARGETS[form.target].toLowerCase()}) in ${scope} by ${Math.abs(percent)}%?`)) return;
    setBusy(true);
    try {
      const { updated } = await api('/admin/prices/bulk', { method: 'POST', body: { ...form, roundTo } });
      toast(`Updated ${updated} prices`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head"><h3>📈 Bulk price change</h3></div>
      <p className="muted">Raise or lower many prices at once. Free items stay free, and product prices never go above their MRP.</p>
      <div className="bulk-form">
        <label>
          What
          <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
            {Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Apply to
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
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
          {busy ? 'Applying…' : `Apply to ${affected.length}`}
        </button>
      </div>
      {!valid && <small className="error-text">Enter a percentage between -90 and 500 (not 0).</small>}

      {valid && affected.length > 0 && (
        <div className="preview">
          <div className="preview-title">Preview · {affected.length} items</div>
          <div className="table-scroll preview-scroll">
            <table className="table compact">
              <thead><tr><th>Item</th><th>Now</th><th>After</th></tr></thead>
              <tbody>
                {affected.map((a) => {
                  const after = newPrice(a.now, percent, roundTo, a.mrp);
                  return (
                    <tr key={a.key}>
                      <td>{a.icon} {a.name} <small className="muted">{a.unit}</small></td>
                      <td>₹{a.now.toLocaleString('en-IN')}</td>
                      <td className={after > a.now ? 'up' : after < a.now ? 'down' : ''}>
                        ₹{after.toLocaleString('en-IN')}
                        {a.mrp && after === Number(a.mrp) && after !== a.now && <small className="muted"> (MRP cap)</small>}
                        {after === a.now && <small className="muted"> (no change)</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function HistoryPanel({ history }) {
  const fmt = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
  return (
    <section className="panel table-panel">
      <div className="panel-head"><h3>🕘 Price history</h3></div>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Item</th><th>Old</th><th>New</th><th>Change</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            {history.data?.map((h) => {
              const mrpChanged = h.kind === 'product' && h.old_mrp !== h.new_mrp && h.old_price === h.new_price;
              const [from, to] = mrpChanged ? [h.old_mrp, h.new_mrp] : [h.old_price, h.new_price];
              const diff = Number(from) > 0 && to != null ? ((to - from) / from) * 100 : null;
              return (
                <tr key={`${h.kind}${h.id}`}>
                  <td>
                    {h.category_icon} {h.name} {h.unit && <small className="muted">{h.unit}</small>}
                    <span className="mini-tag kind">{mrpChanged ? 'MRP' : h.kind}</span>
                  </td>
                  <td>{fmt(from)}</td>
                  <td>{fmt(to)}</td>
                  <td className={diff > 0 ? 'up' : diff < 0 ? 'down' : ''}>
                    {diff === null ? '—' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs(diff).toFixed(1)}%`}
                  </td>
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
  );
}
