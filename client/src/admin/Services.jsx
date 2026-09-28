import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatEta } from '../api.js';
import { ImagePicker, Modal, PriceCell, RowImage, Switch, useLoad, useToast } from './ui.jsx';

export const EMPTY_SERVICE = {
  category_id: '', name: '', description: '', image_url: '', image_credit: '',
  base_price: '', price_unit: '', eta_minutes: '', requires_license: false, is_active: true,
};

export const matchesFilter = (row, { category, q, status }) => {
  const text = `${row.name} ${row.brand || ''} ${row.service_name || ''}`.toLowerCase();
  return (
    (!category || row.category_id === Number(category)) &&
    (!q || text.includes(q.trim().toLowerCase())) &&
    (!status || status === 'all' || (status === 'live') === row.is_active)
  );
};

export default function Services() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState({ category: '', q: '', status: 'all' });
  const [editing, setEditing] = useState(null);
  const cats = useLoad(() => api('/admin/categories'));
  const list = useLoad(() => api('/admin/services'));

  // Dashboard "Add a service" shortcut links here with ?new=1
  useEffect(() => {
    if (params.get('new')) {
      setEditing({ ...EMPTY_SERVICE });
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(() => (list.data || []).filter((s) => matchesFilter(s, filter)), [list.data, filter]);

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className="toolbar-search"
          placeholder="🔍 Search services…"
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
        />
        <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">All statuses</option>
          <option value="live">Live only</option>
          <option value="hidden">Hidden only</option>
        </select>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_SERVICE, category_id: filter.category })}>
          ➕ Add service
        </button>
      </div>

      {list.error && <div className="alert">{list.error}</div>}
      <ServicesTable rows={rows} total={list.data?.length} loading={list.loading && !list.data} reload={list.reload} onEdit={setEditing} />

      {editing && (
        <ServiceForm
          service={editing}
          categories={cats.data || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
          }}
        />
      )}
    </div>
  );
}

export function ServicesTable({ rows, total, loading, reload, onEdit }) {
  const toast = useToast();

  const setPrice = async (s, value) => {
    await api(`/admin/services/${s.id}/price`, { method: 'PATCH', body: { base_price: value } });
    toast(`${s.name}: ₹${Number(s.base_price)} → ₹${Number(value)}`);
    reload();
  };

  const toggleActive = async (s, value) => {
    try {
      await api(`/admin/services/${s.id}/active`, { method: 'PATCH', body: { is_active: value } });
      reload();
      toast(`${s.name} is now ${value ? 'visible to customers' : 'hidden'}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (s) => {
    const extra = s.product_count ? `\nIts ${s.product_count} products will be deleted too.` : '';
    if (!confirm(`Delete "${s.name}" permanently?${extra}\n\nTip: use the Live switch to hide it instead.`)) return;
    try {
      await api(`/admin/services/${s.id}`, { method: 'DELETE' });
      toast(`Deleted ${s.name}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <section className="panel table-panel">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Service <small className="th-hint">· click photo to change</small></th>
              <th>Category</th>
              <th>Price (₹) <small className="th-hint">· click to edit</small></th>
              <th>Time</th>
              <th>Products</th>
              <th>Live</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                <td>
                  <div className="cell-service">
                    <RowImage entity="services" id={s.id} url={s.image_url} icon={s.category_icon} onChanged={reload} />
                    <div>
                      <b>{s.name}</b>
                      {s.requires_license && <span className="mini-tag">Licensed</span>}
                    </div>
                  </div>
                </td>
                <td><span className="cat-pill" style={{ '--c': s.category_color }}>{s.category_icon} {s.category_name}</span></td>
                <td><PriceCell value={s.base_price} unit={s.price_unit} onSave={(v) => setPrice(s, v)} /></td>
                <td className="nowrap">{formatEta(s.eta_minutes)}</td>
                <td className="nowrap">
                  <Link className="link" to={`/admin/products?service=${s.id}`}>
                    {s.product_count ? `${s.product_count} items →` : '＋ Add'}
                  </Link>
                </td>
                <td><Switch checked={s.is_active} onChange={(v) => toggleActive(s, v)} /></td>
                <td className="nowrap actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onEdit(s)}>Edit</button>
                  <button className="icon-btn danger" onClick={() => remove(s)} title="Delete">🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="center-block"><div className="spinner" /></div>}
        {!loading && !rows.length && <p className="empty">No services match these filters.</p>}
      </div>
      {total != null && <div className="table-foot muted">Showing {rows.length} of {total} services</div>}
    </section>
  );
}

export function ServiceForm({ service, categories, onClose, onSaved }) {
  const isNew = !service.id;
  const [form, setForm] = useState(() => ({
    ...EMPTY_SERVICE,
    ...service,
    base_price: service.base_price === '' ? '' : Number(service.base_price),
    description: service.description || '',
    image_url: service.image_url || '',
    image_credit: service.image_credit || '',
    price_unit: service.price_unit || '',
    eta_minutes: service.eta_minutes ?? '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const category = categories.find((c) => c.id === Number(form.category_id));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const saved = await api(isNew ? '/admin/services' : `/admin/services/${service.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: form,
      });
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add a new service' : `Edit: ${service.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="service-form" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add service' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="service-form" className="form admin-form" onSubmit={submit}>
        <ImagePicker
          url={form.image_url}
          credit={form.image_credit}
          fallbackIcon={category?.icon}
          onChange={(img) => setForm((f) => ({ ...f, ...img }))}
        />
        <div className="form-row">
          <label>
            Service name *
            <input value={form.name} onChange={set('name')} placeholder="e.g. Geyser Repair" required autoFocus={isNew} />
          </label>
          <label>
            Category *
            <select value={form.category_id} onChange={set('category_id')} required>
              <option value="">Choose…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </label>
        </div>
        <label>
          Description
          <textarea rows={2} value={form.description} onChange={set('description')} placeholder="Short description shown to customers (optional)" />
        </label>
        <div className="form-row">
          <label>
            Price (₹)
            <input type="number" min="0" step="any" value={form.base_price} onChange={set('base_price')} placeholder="0 = free" />
          </label>
          <label>
            Price unit
            <input value={form.price_unit} onChange={set('price_unit')} placeholder="per visit, per kg, per can…" list="units" />
            <datalist id="units">
              {['per visit', 'visit charge', 'per kg', 'per can', 'per piece', 'per trip', 'per day', 'per month', 'free delivery', 'starting'].map((u) => <option key={u} value={u} />)}
            </datalist>
          </label>
          <label>
            Time to deliver (minutes)
            <input type="number" min="0" value={form.eta_minutes} onChange={set('eta_minutes')} placeholder="e.g. 60" />
          </label>
        </div>
        <div className="form-row switches">
          <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Live (visible to customers)" />
          <Switch checked={form.requires_license} onChange={(v) => setForm({ ...form, requires_license: v })} label="Needs licensed partner" />
        </div>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
