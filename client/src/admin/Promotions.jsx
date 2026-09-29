import { useState } from 'react';
import { api } from '../api.js';
import { ImagePicker, Modal, Switch, useLoad, useToast } from './ui.jsx';
import { PromoCard } from '../components/Promotions.jsx';

const STATE = {
  live: { label: 'Live', color: '#16a34a' },
  scheduled: { label: 'Scheduled', color: '#2563eb' },
  expired: { label: 'Expired', color: '#94a3b8' },
  off: { label: 'Off', color: '#64748b' },
};
const PLACEMENTS = { carousel: '🖼️ Big sliding banner', tile: '🔲 Small tile' };
const COLORS = ['#4f46e5', '#16a34a', '#1d4ed8', '#b45309', '#dc2626', '#7c3aed', '#0e7490', '#db2777', '#0f172a', '#ea580c'];

const EMPTY = {
  name: '', title: '', subtitle: '', image_url: '', image_credit: '', cta_text: 'Order now', link_type: 'none', link_value: '',
  placement: 'carousel', bg_color: '#4f46e5', text_color: '#ffffff', starts_at: '', ends_at: '', is_active: true,
};

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" in local time.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Promotions() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/promotions'));
  const [editing, setEditing] = useState(null);

  const act = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const section = (placement) => (list.data || []).filter((p) => p.placement === placement);

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Promotions appear on the customer home page, below the welcome banner. Big banners slide automatically every 5 seconds;
          tiles show in a row below them. Use dates to run an offer only for a festival or a week.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>➕ Add promotion</button>
      </div>
      {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}

      {['carousel', 'tile'].map((placement) => (
        <section key={placement} className="stack">
          <h3 className="promo-section-title">{PLACEMENTS[placement]} <span className="muted small">· shown in this order</span></h3>
          {list.data && !section(placement).length && <p className="muted panel">None yet.</p>}
          {section(placement).map((p, i, arr) => (
            <article key={p.id} className={`panel promo-admin ${p.state === 'live' ? '' : 'row-muted-soft'}`}>
              <div className={`promo-admin-preview ${placement}`}><PromoCard p={p} variant={placement === 'tile' ? 'tile' : 'slide'} preview /></div>
              <div className="promo-admin-info">
                <div className="promo-admin-head">
                  <b>{p.name}</b>
                  <span className="status-badge" style={{ '--c': STATE[p.state].color }}>{STATE[p.state].label}</span>
                </div>
                <small className="muted">
                  {p.starts_at || p.ends_at
                    ? `${p.starts_at ? `From ${fmt(p.starts_at)}` : 'From now'}${p.ends_at ? ` until ${fmt(p.ends_at)}` : ', no end date'}`
                    : 'Always on'}
                </small>
                <small className="muted">
                  {p.link_type === 'none' ? 'No link' : `Opens ${p.href}`}
                </small>
                <div className="promo-stats">
                  <span>👁 {Number(p.views).toLocaleString('en-IN')} views</span>
                  <span>👆 {Number(p.clicks).toLocaleString('en-IN')} clicks</span>
                  <span>{p.ctr != null ? `${p.ctr}% click rate` : '—'}</span>
                </div>
              </div>
              <div className="promo-admin-actions">
                <Switch checked={p.is_active} onChange={(v) => act(() => api(`/admin/promotions/${p.id}/active`, { method: 'PATCH', body: { is_active: v } }), v ? 'Promotion switched on' : 'Promotion switched off')} />
                <div className="move-btns">
                  <button className="icon-btn" disabled={i === 0} onClick={() => act(() => api(`/admin/promotions/${p.id}/move`, { method: 'POST', body: { direction: -1 } }))} title="Move up" aria-label="Move up">▲</button>
                  <button className="icon-btn" disabled={i === arr.length - 1} onClick={() => act(() => api(`/admin/promotions/${p.id}/move`, { method: 'POST', body: { direction: 1 } }))} title="Move down" aria-label="Move down">▼</button>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>Edit</button>
                <button className="icon-btn danger" title="Delete" onClick={() => confirm(`Delete "${p.name}"?`) && act(() => api(`/admin/promotions/${p.id}`, { method: 'DELETE' }), 'Promotion deleted')}>🗑️</button>
              </div>
            </article>
          ))}
        </section>
      ))}

      {editing && (
        <PromotionForm
          promo={editing}
          onClose={() => setEditing(null)}
          onSaved={(p, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${p.name}` : `Saved ${p.name}`);
          }}
        />
      )}
    </div>
  );
}

function PromotionForm({ promo, onClose, onSaved }) {
  const isNew = !promo.id;
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(Object.entries(promo).map(([k, v]) => [k, v ?? ''])),
    starts_at: toLocalInput(promo.starts_at),
    ends_at: toLocalInput(promo.ends_at),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cats = useLoad(() => api('/admin/categories'));
  const services = useLoad(() => api('/admin/services'));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form, starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at) };
      const saved = await api(isNew ? '/admin/promotions' : `/admin/promotions/${promo.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // What the customer will see, updated as you type.
  const preview = { ...form, href: form.link_type === 'none' ? null : '#' };

  return (
    <Modal
      title={isNew ? 'Add a promotion' : `Edit: ${promo.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="promo-form" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add promotion' : 'Save changes'}</button>
        </>
      }
    >
      <form id="promo-form" className="form admin-form" onSubmit={submit}>
        <div className="promo-preview-box">
          <small className="muted">Preview</small>
          <div className={`promo-admin-preview big ${form.placement}`}>
            <PromoCard p={preview} variant={form.placement === 'tile' ? 'tile' : 'slide'} preview />
          </div>
        </div>

        <div className="seg">
          {Object.entries(PLACEMENTS).map(([k, v]) => (
            <button type="button" key={k} className={form.placement === k ? 'active' : ''} onClick={() => setForm({ ...form, placement: k })}>{v}</button>
          ))}
        </div>

        <label>
          Name (only you see this) *
          <input value={form.name} onChange={set('name')} placeholder="e.g. Diwali milk offer" required autoFocus={isNew} />
        </label>

        <ImagePicker url={form.image_url} credit={form.image_credit} fallbackIcon="📢" onChange={(img) => setForm((f) => ({ ...f, ...img }))} />
        <small className="muted">Image is optional. Best size: wide photo, about 1200 × 500. Without a title the image fills the whole banner.</small>

        <div className="form-row">
          <label>Title (optional)<input value={form.title} onChange={set('title')} maxLength={90} placeholder="e.g. Flat ₹50 off on groceries" /></label>
          <label>Button text (optional)<input value={form.cta_text} onChange={set('cta_text')} maxLength={30} placeholder="Order now" /></label>
        </div>
        <label>Description (optional)<textarea rows={2} value={form.subtitle} onChange={set('subtitle')} maxLength={200} placeholder="e.g. On orders above ₹499 this weekend" /></label>

        <div className="form-row">
          <label>
            When tapped, open
            <select value={form.link_type} onChange={(e) => setForm({ ...form, link_type: e.target.value, link_value: '' })}>
              <option value="none">Nothing (just an announcement)</option>
              <option value="category">A category</option>
              <option value="service">A service / shop</option>
              <option value="url">A website link</option>
            </select>
          </label>
          {form.link_type === 'category' && (
            <label>
              Category
              <select value={form.link_value} onChange={set('link_value')} required>
                <option value="">Choose…</option>
                {cats.data?.map((c) => <option key={c.id} value={c.slug}>{c.icon} {c.name}</option>)}
              </select>
            </label>
          )}
          {form.link_type === 'service' && (
            <label>
              Service
              <select value={form.link_value} onChange={set('link_value')} required>
                <option value="">Choose…</option>
                {services.data?.map((s) => <option key={s.id} value={s.slug}>{s.category_icon} {s.name}</option>)}
              </select>
            </label>
          )}
          {form.link_type === 'url' && (
            <label>Website<input value={form.link_value} onChange={set('link_value')} placeholder="https://…" required /></label>
          )}
        </div>

        <div className="form-row">
          <label>
            Background colour
            <div className="color-field">
              <input type="color" value={form.bg_color} onChange={set('bg_color')} />
              <div className="swatches">
                {COLORS.map((c) => <button type="button" key={c} style={{ background: c }} className={form.bg_color === c ? 'active' : ''} onClick={() => setForm({ ...form, bg_color: c })} aria-label={c} />)}
              </div>
            </div>
          </label>
          <label>
            Text colour
            <div className="seg">
              <button type="button" className={form.text_color === '#ffffff' ? 'active' : ''} onClick={() => setForm({ ...form, text_color: '#ffffff' })}>White</button>
              <button type="button" className={form.text_color === '#0f172a' ? 'active' : ''} onClick={() => setForm({ ...form, text_color: '#0f172a' })}>Dark</button>
            </div>
          </label>
        </div>

        <div className="form-row">
          <label>Show from (optional)<input type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></label>
          <label>Show until (optional)<input type="datetime-local" value={form.ends_at} onChange={set('ends_at')} /></label>
        </div>
        <small className="muted">Leave dates empty to show it all the time. Expired promotions hide themselves automatically.</small>

        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="On (visible to customers)" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
