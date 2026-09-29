import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';

// Which type of agent does which services. Orders only go to agents with the matching type.
export default function ServiceTypes() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/service-types'));
  const [editing, setEditing] = useState(null);

  const gaps = (list.data || []).filter((t) => t.is_active && t.services > 0 && t.agents === 0);

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Every service has one type, and every agent has one or more. An order is only shown to agents of the same type,
          e.g. <b>Plumber on Demand</b> goes only to <b>Plumbing</b> agents.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing({ code: '', name: '', agent_title: '', icon: '', is_active: true })}>➕ Add type</button>
      </div>

      {gaps.length > 0 && (
        <div className="gap-alert">
          ⚠️ No active agents for: <b>{gaps.map((t) => `${t.icon} ${t.name}`).join(', ')}</b>. Orders for these services will wait until you
          <Link to="/admin/agents"> add an agent</Link> or give an existing agent this type.
        </div>
      )}

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Type</th><th>Customer sees</th><th>Services</th><th>Agents</th><th>Free now</th><th>Orders waiting</th><th aria-label="Edit" /></tr>
            </thead>
            <tbody>
              {/* Retired types (turned off, nothing uses them) are hidden. */}
              {list.data?.filter((t) => t.is_active || t.services || t.agents || t.orders_waiting).map((t) => (
                <tr key={t.code} className={t.is_active ? '' : 'row-muted'}>
                  <td><span className="type-icon">{t.icon}</span> <b>{t.name}</b> <span className="muted small">{t.code}</span></td>
                  <td>“Your {t.agent_title.toLowerCase()}”</td>
                  <td>{t.services}</td>
                  <td>
                    <Link className="link" to={`/admin/agents?skill=${t.code}`}>{t.agents}</Link>
                    {t.services > 0 && t.agents === 0 && <span className="mini-tag warn-tag">none!</span>}
                  </td>
                  <td>{t.agents_free > 0 ? <span className="free-count">🟢 {t.agents_free}</span> : <span className="muted">0</span>}</td>
                  <td>{t.orders_waiting > 0 ? <Link className="link" to={`/admin/orders?skill=${t.code}`}>⏳ {t.orders_waiting}</Link> : <span className="muted">0</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
        </div>
      </section>
      <p className="muted small">To change a service's type, use the <Link className="link" to="/admin/services">Services</Link> page. To change an agent's types, open the agent in <Link className="link" to="/admin/agents">Manage agents</Link>.</p>

      {editing && (
        <TypeForm
          type={editing}
          onClose={() => setEditing(null)}
          onSaved={(t, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${t.name}` : `Saved ${t.name}`);
          }}
        />
      )}
    </div>
  );
}

function TypeForm({ type, onClose, onSaved }) {
  const isNew = !type.code;
  const [form, setForm] = useState({ name: type.name, agent_title: type.agent_title, icon: type.icon || '', is_active: type.is_active });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api(isNew ? '/admin/service-types' : `/admin/service-types/${type.code}`, { method: isNew ? 'POST' : 'PUT', body: form });
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add a type of work' : `Edit: ${type.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="type-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="type-form" className="form" onSubmit={submit}>
        <div className="form-row">
          <label>Name *<input value={form.name} onChange={set('name')} placeholder="e.g. Gardening" required autoFocus /></label>
          <label>Icon<input value={form.icon} onChange={set('icon')} placeholder="🌱" /></label>
        </div>
        <label>
          What customers call the agent *
          <input value={form.agent_title} onChange={set('agent_title')} placeholder="e.g. Gardener" required />
          <small className="muted">Shown on tracking: “Your {(form.agent_title || 'gardener').toLowerCase()} is on the way”.</small>
        </label>
        {!isNew && <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active (agents can choose it)" />}
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
