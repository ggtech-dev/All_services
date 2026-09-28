import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, uploadImage } from '../api.js';

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

// ---------- editable price: click to edit, Enter saves, Esc cancels ----------
// onSave(value) should return a promise; value is '' when cleared (only if allowEmpty).
export function PriceCell({ value, unit, onSave, allowEmpty = false, emptyLabel = 'Free', strike = false }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const has = value !== null && value !== undefined && value !== '';
  const amount = Number(value);

  const start = () => {
    setDraft(has ? String(amount) : '');
    setEditing(true);
  };
  // fromBlur: clicking away after a failed save closes the box and keeps the old price.
  const save = async (fromBlur = false) => {
    if (busy) return;
    const same = draft === '' ? !has : has && Number(draft) === amount;
    if (same) return setEditing(false);
    if (draft === '' && !allowEmpty) return toast('Enter a price', 'error');
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      toast(e.message, 'error');
      if (fromBlur) setEditing(false);
      else inputRef.current?.focus(); // keep it open so the admin can fix the value or press Esc
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button className={`price-btn ${strike ? 'price-mrp' : ''}`} onClick={start} title="Click to change">
        <b>{has ? (amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : 'Free') : emptyLabel}</b>
        {unit && <small>{unit}</small>}
        <span className="pencil">✎</span>
      </button>
    );
  }
  return (
    <div className="price-edit">
      <span>₹</span>
      <input
        ref={inputRef}
        autoFocus
        type="number"
        min="0"
        step="any"
        value={draft}
        readOnly={busy}
        placeholder={allowEmpty ? 'none' : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => save(true)}
      />
    </div>
  );
}

// ---------- editable short text (pack size / quantity / unit) ----------
export function TextCell({ value, placeholder = 'add', onSave }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (draft.trim() === (value || '')) return setEditing(false);
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      toast(e.message, 'error');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="text-btn"
        title="Click to change quantity"
        onClick={() => {
          setDraft(value || '');
          setEditing(true);
        }}
      >
        {value || <span className="muted">{placeholder}</span>} <span className="pencil">✎</span>
      </button>
    );
  }
  return (
    <input
      className="text-edit"
      autoFocus
      value={draft}
      readOnly={busy}
      maxLength={30}
      placeholder="e.g. 20 L, 500 g"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') setEditing(false);
      }}
      onBlur={save}
    />
  );
}

// ---------- row photo: click the thumbnail to upload a new one, ✕ to remove it ----------
// The server deletes the previous uploaded file when a photo is replaced or removed.
export function RowImage({ entity, id, url, icon, onChanged }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [url]);

  const setImage = async (image_url, message) => {
    setBusy(true);
    try {
      await api(`/admin/${entity}/${id}/image`, { method: 'PATCH', body: { image_url, image_credit: '' } });
      toast(message);
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await setImage(await uploadImage(file), url ? 'Photo replaced (old one deleted)' : 'Photo added');
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  const remove = (e) => {
    e.stopPropagation();
    if (confirm('Remove this photo? The emoji tile will be shown instead.')) setImage('', 'Photo removed');
  };

  return (
    <span className="thumb-wrap">
      <button type="button" className="thumb thumb-btn" onClick={() => fileRef.current.click()} title={url ? 'Click to replace photo' : 'Click to add photo'} disabled={busy}>
        {url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span>{icon || '🖼️'}</span>}
        <span className="thumb-overlay">{busy ? '…' : '📷'}</span>
      </button>
      {url && !busy && (
        <button type="button" className="thumb-remove" onClick={remove} title="Remove photo" aria-label="Remove photo">✕</button>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={onFile} />
    </span>
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
