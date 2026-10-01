import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';

// Local shops agents buy from. At checkout a customer may choose one; the agent then buys only there.
export default function Shops() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/shops'));
  const services = useLoad(() => api('/admin/services'));
  const areas = useLoad(() => api('/localities'));
  const [editing, setEditing] = useState(null);

  const toggle = async (sh) => {
    try {
      await api(`/admin/shops/${sh.id}`, { method: 'PUT', body: { ...sh, is_active: !sh.is_active } });
      toast(`${sh.name} ${sh.is_active ? 'switched off' : 'switched on'}`);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Shops your agents buy from (kirana, vegetables, meat…). At checkout customers can pick one of these — the agent then buys
          <b> only from that shop</b>. Customers can also type another shop's name.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', locality_id: '', address: '', phone: '', service_ids: [], is_active: true })}>➕ Add shop</button>
      </div>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Shop</th><th>Area</th><th>Sells</th><th>Phone</th><th>Chosen in orders</th><th>On</th><th aria-label="Edit" /></tr></thead>
            <tbody>
              {(list.data || []).map((sh) => (
                <tr key={sh.id} className={sh.is_active ? '' : 'row-muted'}>
                  <td><b>{sh.name}</b>{sh.address && <div className="muted small">{sh.address}</div>}</td>
                  <td>{sh.locality_name || <span className="muted">—</span>}</td>
                  <td className="small">{sh.services.join(', ')}</td>
                  <td>{sh.phone ? <a className="link" href={`tel:${sh.phone}`}>{sh.phone}</a> : <span className="muted">—</span>}</td>
                  <td>{sh.orders}</td>
                  <td><Switch checked={sh.is_active} onChange={() => toggle(sh)} label="" /></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing(sh)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !list.data.length && <p className="muted panel-pad">No shops yet. Add the shops your agents usually buy from.</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>

      {editing && (
        <ShopForm
          shop={editing}
          services={services.data || []}
          areas={areas.data || []}
          onClose={() => setEditing(null)}
          onSaved={(sh, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${sh.name}` : `Saved ${sh.name}`);
          }}
        />
      )}
    </div>
  );
}

function ShopForm({ shop, services, areas, onClose, onSaved }) {
  const isNew = !shop.id;
  const [form, setForm] = useState({ ...shop, locality_id: shop.locality_id ?? '', address: shop.address || '', phone: shop.phone || '' });
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  // shops matter for "price as per shop bill" services; others on request
  const choices = services.filter((s) => showAll || s.price_on_bill || form.service_ids.includes(s.id));
  const toggleService = (id) => setForm((f) => ({ ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter((x) => x !== id) : [...f.service_ids, id] }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form, locality_id: form.locality_id === '' ? null : Number(form.locality_id) };
      const sh = await api(isNew ? '/admin/shops' : `/admin/shops/${shop.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(sh, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add shop' : `Edit ${shop.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="shop-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="shop-form" className="form admin-form" onSubmit={save}>
        <div className="form-row">
          <label>Shop name *<input value={form.name} onChange={set('name')} placeholder="e.g. Sri Balaji Kirana" maxLength={80} required autoFocus={isNew} /></label>
          <label>
            Area
            <select value={form.locality_id} onChange={set('locality_id')}>
              <option value="">—</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Shop phone<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="10-digit mobile (optional)" /></label>
          <label>Address / landmark<input value={form.address} onChange={set('address')} placeholder="e.g. Near Old Bus Stand (optional)" maxLength={200} /></label>
        </div>
        <div>
          <b className="small">Sells for *</b>
          <div className="skill-picker">
            {choices.map((s) => (
              <button type="button" key={s.id} className={form.service_ids.includes(s.id) ? 'active' : ''} aria-pressed={form.service_ids.includes(s.id)} onClick={() => toggleService(s.id)}>
                <span>{s.category_icon}</span> {s.name}
              </button>
            ))}
          </div>
          <button type="button" className="link-btn small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show market-price services only' : 'Show all services'}</button>
        </div>
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Customers can choose this shop" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
