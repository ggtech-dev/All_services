import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Switch, useToast } from './ui.jsx';

const FIELDS = [
  { key: 'banner_title', label: 'Home banner title', placeholder: 'What do you need today?' },
  { key: 'banner_subtitle', label: 'Home banner subtitle', textarea: true },
  { key: 'announcement', label: 'Announcement strip', placeholder: 'Leave empty to hide', hint: 'Shown in a coloured strip above the banner. Leave empty to hide it.' },
  { key: 'service_city', label: 'Service city', placeholder: 'Siddipet, Telangana' },
  { key: 'support_phone', label: 'Support phone (Call)', placeholder: '+91 98765 43210', hint: 'Shown on the login page and home as Call / WhatsApp / Mail help links. Leave empty to hide one.' },
  { key: 'support_whatsapp', label: 'Support WhatsApp number', placeholder: '+91 98765 43210' },
  { key: 'support_email', label: 'Support email', placeholder: 'help@example.com' },
  { key: 'agent_pay_per_order', label: 'Agent pay per delivery (₹)', number: true, hint: 'Added to the agent wallet when they deliver.' },
  { key: 'agent_max_active_orders', label: 'Orders an agent can carry at once', number: true, hint: '1 = agent must deliver before taking the next order.' },
  { key: 'require_delivery_otp', label: 'Ask customer OTP on delivery', toggle: true, hint: 'On: the agent must enter the 4-digit code from the customer’s app to finish. Off: the agent just taps “Mark delivered”.' },
];

export default function Settings() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/settings').then((s) => {
      setForm(s);
      setSaved(s);
    });
  }, []);

  if (!form) return <div className="center-block"><div className="spinner" /></div>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key] || '']));
      await api('/admin/settings', { method: 'PUT', body });
      setSaved(form);
      toast('Settings saved — customers see them right away');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="two-col settings-layout">
      <form className="panel form" onSubmit={submit}>
        <h3>Customer home page & delivery</h3>
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.toggle ? (
              <Switch checked={form[f.key] === '1'} onChange={(v) => setForm({ ...form, [f.key]: v ? '1' : '0' })} label={form[f.key] === '1' ? 'On' : 'Off'} />
            ) : f.textarea ? (
              <textarea rows={3} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input type={f.number ? 'number' : 'text'} min={f.number ? 0 : undefined} value={form[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setForm(saved)}>Reset</button>
          <button className="btn btn-primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>

      <section className="panel">
        <h3>Live preview</h3>
        <div className="preview-frame">
          {form.announcement && <div className="announcement">{form.announcement}</div>}
          <section className="banner">
            <div>
              <h1>{form.banner_title || 'What do you need today?'}</h1>
              <p>{form.banner_subtitle}</p>
            </div>
            <div className="banner-meta">
              {form.service_city && <span>📍 {form.service_city}</span>}
              {form.support_phone && <span>📞 {form.support_phone}</span>}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
