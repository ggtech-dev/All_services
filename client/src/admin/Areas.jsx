import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';
import MapView from '../components/LazyMap.jsx';

// Service areas (localities) customers choose at checkout; also used to find the nearest agent.
// Areas are never deleted — old orders point to them — they are switched off instead.
export default function Areas() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/localities'));
  const [editing, setEditing] = useState(null);
  const [showOff, setShowOff] = useState(false);

  const areas = list.data || [];
  const shown = areas.filter((a) => showOff || a.is_active);
  const offCount = areas.filter((a) => !a.is_active).length;

  const toggle = async (a) => {
    try {
      await api(`/admin/localities/${a.id}`, { method: 'PUT', body: { name: a.name, pincode: a.pincode || '', lat: a.lat, lng: a.lng, is_active: !a.is_active } });
      toast(`${a.name} ${a.is_active ? 'switched off' : 'switched on'}`);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Customers pick one of these areas at checkout. Switched-off areas are hidden from customers (old orders keep them).
          Tap an area's pin on the map to edit it.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', pincode: '', lat: null, lng: null, is_active: true })}>➕ Add area</button>
      </div>

      <section className="panel">
        <MapView
          height={340}
          fitKey={`${list.data ? 'ok' : ''}-${showOff}`}
          markers={shown.map((a) => ({
            id: a.id, lat: Number(a.lat), lng: Number(a.lng), emoji: '📍', color: a.is_active ? '#4f46e5' : '#94a3b8',
            label: `${a.name}${a.is_active ? '' : ' (off)'}`, onClick: () => setEditing(a),
          }))}
        />
      </section>

      <section className="panel table-panel">
        <div className="panel-head">
          <h3>🗺️ {areas.filter((a) => a.is_active).length} active areas</h3>
          {offCount > 0 && <Switch checked={showOff} onChange={setShowOff} label={`Show ${offCount} switched-off`} />}
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Area</th><th>Pincode</th><th>Orders</th><th>Agents</th><th>On</th><th aria-label="Edit" /></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                  <td><b>{a.name}</b></td>
                  <td>{a.pincode || <span className="muted">—</span>}</td>
                  <td>{a.orders}</td>
                  <td>{a.agents}</td>
                  <td><Switch checked={a.is_active} onChange={() => toggle(a)} label="" /></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>

      {editing && (
        <AreaForm
          area={editing}
          onClose={() => setEditing(null)}
          onSaved={(a, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${a.name}` : `Saved ${a.name}`);
          }}
        />
      )}
    </div>
  );
}

function AreaForm({ area, onClose, onSaved }) {
  const isNew = !area.id;
  const [form, setForm] = useState({
    name: area.name, pincode: area.pincode || '', is_active: area.is_active,
    lat: area.lat == null ? null : Number(area.lat), lng: area.lng == null ? null : Number(area.lng),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsMsg, setGpsMsg] = useState('');
  const hasPin = form.lat != null && form.lng != null;

  const useMyLocation = () => {
    if (!navigator.geolocation) return setGpsMsg('Location is not available on this device');
    setGpsMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }));
        setGpsMsg('');
      },
      () => setGpsMsg('Allow location access, or tap the map'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!hasPin) return setError('Tap the map to set where this area is');
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim(), pincode: form.pincode.trim() };
      const a = await api(isNew ? '/admin/localities' : `/admin/localities/${area.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(a, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add area' : `Edit ${area.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="area-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="area-form" className="stack-sm" onSubmit={save}>
        <div className="form-row">
          <label>
            Area name *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bharath Nagar" maxLength={80} required autoFocus={isNew} />
          </label>
          <label>
            Pincode
            <input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" placeholder="502103" />
          </label>
        </div>
        <div className="area-pin-row">
          <span className={hasPin ? 'success-text' : 'muted'}>{hasPin ? `📍 ${form.lat}, ${form.lng}` : '👆 Tap the map at the centre of this area'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation}>📡 Use my location</button>
        </div>
        {gpsMsg && <small className="muted">{gpsMsg}</small>}
        <MapView
          height={300}
          fitKey={hasPin ? 'pin' : 'none'}
          markers={hasPin ? [{ id: 'pin', lat: form.lat, lng: form.lng, emoji: '📍', color: '#4f46e5' }] : []}
          onMapClick={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
        />
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Customers can choose this area" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
