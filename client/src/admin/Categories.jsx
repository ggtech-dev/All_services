import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ImagePicker, Modal, Switch, useLoad, useToast } from './ui.jsx';

const EMPTY = { name: '', icon: '', description: '', image_url: '', image_credit: '', color: '#4f46e5', is_active: true };
const ICONS = ['🏠', '🛒', '💊', '🚗', '👨‍👩‍👧', '♻️', '📦', '🧹', '🔧', '💇', '🐶', '📚', '🍱', '🎉', '🧺', '⚡'];

export default function Categories() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(null);
  const list = useLoad(() => api('/admin/categories'));

  useEffect(() => {
    if (params.get('new')) {
      setEditing({ ...EMPTY });
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const save = async (c, changes, message) => {
    try {
      await api(`/admin/categories/${c.id}`, { method: 'PUT', body: { ...c, ...changes } });
      toast(message);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (c) => {
    if (!confirm(`Delete the category "${c.name}"?`)) return;
    try {
      await api(`/admin/categories/${c.id}`, { method: 'DELETE' });
      toast(`Deleted ${c.name}`);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">These are the cards customers see on the home page, in this order.</p>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>➕ Add category</button>
      </div>
      {list.error && <div className="alert">{list.error}</div>}
      {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}

      <div className="admin-cat-grid">
        {list.data?.map((c) => (
          <article key={c.id} className={`admin-cat ${c.is_active ? '' : 'row-muted'}`} style={{ '--accent': c.color }}>
            <div className="admin-cat-img">
              {c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <span>{c.icon}</span>}
              <span className="category-icon">{c.icon}</span>
            </div>
            <div className="admin-cat-body">
              <h3>{c.name}</h3>
              <p className="muted">{c.description}</p>
              <Link to="/admin/services" className="link">{c.service_count} services</Link>
            </div>
            <footer className="admin-cat-foot">
              <Switch
                checked={c.is_active}
                onChange={(v) => save(c, { is_active: v }, `${c.name} is now ${v ? 'visible' : 'hidden'}`)}
                label={c.is_active ? 'Live' : 'Hidden'}
              />
              <div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>
                <button className="icon-btn danger" onClick={() => remove(c)} title="Delete">🗑️</button>
              </div>
            </footer>
          </article>
        ))}
      </div>

      {editing && (
        <CategoryForm
          category={editing}
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

function CategoryForm({ category, onClose, onSaved }) {
  const isNew = !category.id;
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...category,
    description: category.description || '',
    image_url: category.image_url || '',
    image_credit: category.image_credit || '',
    icon: category.icon || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const saved = await api(isNew ? '/admin/categories' : `/admin/categories/${category.id}`, {
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
      title={isNew ? 'Add a category' : `Edit: ${category.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="category-form" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add category' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="category-form" className="form admin-form" onSubmit={submit}>
        <ImagePicker url={form.image_url} credit={form.image_credit} fallbackIcon={form.icon} onChange={(img) => setForm((f) => ({ ...f, ...img }))} />
        <label>
          Name *
          <input value={form.name} onChange={set('name')} placeholder="e.g. Festival & Events" required autoFocus={isNew} />
        </label>
        <label>
          Description
          <textarea rows={2} value={form.description} onChange={set('description')} placeholder="One line shown on the home page card" />
        </label>
        <div className="form-row">
          <label>
            Icon (emoji)
            <input value={form.icon} onChange={set('icon')} placeholder="🏠" />
            <div className="emoji-row">
              {ICONS.map((i) => (
                <button type="button" key={i} className={form.icon === i ? 'active' : ''} onClick={() => setForm({ ...form, icon: i })}>{i}</button>
              ))}
            </div>
          </label>
          <label>
            Accent colour
            <div className="color-field">
              <input type="color" value={form.color} onChange={set('color')} />
              <input value={form.color} onChange={set('color')} />
            </div>
          </label>
        </div>
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Live (visible to customers)" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
