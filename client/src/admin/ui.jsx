import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { uploadImage } from '../api.js';

// ---------- toasts ----------
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.type === 'error' ? '⚠️' : '✅'} {t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- switch ----------
export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch-ctl">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track"><span className="switch-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

// ---------- image picker: upload a file or paste a URL ----------
export function ImagePicker({ url, credit, onChange, fallbackIcon = '🖼️' }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [url]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      // Uploaded photos are the admin's own, so the old attribution no longer applies.
      onChange({ image_url: await uploadImage(file), image_credit: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-picker">
      <div className="image-preview">
        {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : <span>{broken ? '⚠️' : fallbackIcon}</span>}
        {busy && <div className="image-busy"><div className="spinner" /></div>}
      </div>
      <div className="image-controls">
        <div className="image-buttons">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()} disabled={busy}>
            📤 Upload photo
          </button>
          {url && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ image_url: '', image_credit: '' })}>
              Remove
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={onFile} />
        </div>
        <input
          value={url || ''}
          placeholder="…or paste an image URL"
          onChange={(e) => onChange({ image_url: e.target.value, image_credit: credit })}
        />
        {broken && <small className="error-text">This image could not be loaded.</small>}
        {error && <small className="error-text">{error}</small>}
        {credit && <small className="muted credit-text" title={credit}>Credit: {credit}</small>}
      </div>
    </div>
  );
}

// ---------- data loader ----------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return loader()
      .then((data) => setState({ data, loading: false, error: '' }))
      .catch((e) => setState({ data: null, loading: false, error: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

export const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
