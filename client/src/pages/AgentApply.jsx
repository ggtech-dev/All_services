import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { VEHICLES } from '../orderStatus.jsx';

// Also used by the admin "Add agent" form (with docsRequired=false and a custom submit).
export const AGENT_DOCS = [
  { field: 'aadhaar_doc', label: 'Aadhaar card', hint: 'Front side, all 12 digits visible' },
  { field: 'pan_doc', label: 'PAN card' },
  { field: 'dl_doc', label: 'Driving licence' },
  { field: 'photo_doc', label: 'Your photo', hint: 'Optional, clear face photo', optional: true },
];

export function AgentForm({ docsRequired = true, submitLabel, onSubmit }) {
  const [localities, setLocalities] = useState([]);
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', username: '', password: '', vehicle_type: 'bike', vehicle_number: '',
    locality_id: '', aadhaar_number: '', pan_number: '', dl_number: '',
  });
  const [files, setFiles] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, f]) => f && fd.append(k, f));
    setBusy(true);
    try {
      await onSubmit(fd);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="form agent-form" onSubmit={submit}>
      <fieldset>
        <legend>1. Your details</legend>
        <div className="form-row">
          <label>Full name (as on Aadhaar) *<input value={form.full_name} onChange={set('full_name')} required /></label>
          <label>Mobile number *<input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile" /></label>
        </div>
        <div className="form-row">
          <label>Email<input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" /></label>
          <label>
            Area you'll work in
            <select value={form.locality_id} onChange={set('locality_id')}>
              <option value="">Choose area…</option>
              {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>2. Vehicle</legend>
        <div className="form-row">
          <label>
            Vehicle type *
            <select value={form.vehicle_type} onChange={set('vehicle_type')}>
              {Object.entries(VEHICLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Vehicle number<input value={form.vehicle_number} onChange={set('vehicle_number')} placeholder="TS09 AB 1234" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>3. Documents</legend>
        <div className="form-row">
          <label>Aadhaar number {docsRequired && '*'}<input value={form.aadhaar_number} onChange={set('aadhaar_number')} required={docsRequired} inputMode="numeric" placeholder="1234 5678 9012" /></label>
          <label>PAN number {docsRequired && '*'}<input value={form.pan_number} onChange={set('pan_number')} required={docsRequired} placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} /></label>
          <label>Driving licence no. {docsRequired && '*'}<input value={form.dl_number} onChange={set('dl_number')} required={docsRequired} placeholder="TS0920190012345" style={{ textTransform: 'uppercase' }} /></label>
        </div>
        <div className="doc-grid">
          {AGENT_DOCS.map((d) => (
            <DocInput key={d.field} doc={d} required={docsRequired && !d.optional} file={files[d.field]} onChange={(f) => setFiles({ ...files, [d.field]: f })} />
          ))}
        </div>
        <small className="muted">🔒 Documents are stored privately and only seen by our verification team. We keep only the last 4 digits of your Aadhaar number.</small>
      </fieldset>

      <fieldset>
        <legend>4. Login for the agent app</legend>
        <div className="form-row">
          <label>Username *<input value={form.username} onChange={set('username')} required autoComplete="username" placeholder="e.g. kiran_hyd" /></label>
          <label>Password *<input type="password" value={form.password} onChange={set('password')} required autoComplete="new-password" placeholder="Min 6 characters" /></label>
        </div>
      </fieldset>

      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : submitLabel}</button>
    </form>
  );
}

function DocInput({ doc, required, file, onChange }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className={`doc-input ${file ? 'has-file' : ''}`}>
      <span className="doc-preview">
        {preview ? <img src={preview} alt="" /> : <span>{file ? '📄' : '📤'}</span>}
      </span>
      <span className="doc-text">
        <b>{doc.label}{required && ' *'}</b>
        <small className="muted">{file ? file.name : doc.hint || 'JPG, PNG or PDF, max 5 MB'}</small>
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        required={required && !file}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}

// Public page: /agent/apply — share this link with people who want to deliver for us.
export default function AgentApply() {
  const [done, setDone] = useState(false);

  return (
    <div className="apply-page">
      <header className="apply-hero">
        <Link to="/login" className="brand brand-lg"><span className="brand-logo">AS</span><span>All Services</span></Link>
        <h1>Deliver with All Services 🛵</h1>
        <p>Earn on every delivery across Hyderabad. Choose your own hours, get paid to your wallet, work near home.</p>
        <div className="hero-chips">
          <span className="chip">💰 Earn per delivery</span>
          <span className="chip">🕒 Flexible hours</span>
          <span className="chip">📍 Work in your area</span>
        </div>
      </header>

      <main className="apply-card">
        {done ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <h2>Application submitted!</h2>
            <p className="muted">Our team will verify your documents, usually within 24–48 hours. Once approved you can log in with the <b>Agent</b> tab using the username and password you chose.</p>
            <Link to="/login?as=agent" className="btn btn-primary">Go to agent login</Link>
          </div>
        ) : (
          <>
            <h2>Apply to become a delivery agent</h2>
            <p className="muted">Fill in your details and upload your documents. Fields marked * are required.</p>
            <AgentForm
              submitLabel="Submit application"
              onSubmit={async (fd) => {
                await api('/agents/apply', { method: 'POST', body: fd });
                setDone(true);
                window.scrollTo(0, 0);
              }}
            />
            <p className="switch">Already approved? <Link to="/login?as=agent">Agent login</Link></p>
          </>
        )}
      </main>
    </div>
  );
}
