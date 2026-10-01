import { useState } from 'react';
import { api } from '../api.js';

// After delivery the customer rates the agent: 1–5 ⭐, quick tags and an optional comment. Can be changed for 7 days.
const GOOD = ['On time', 'Polite', 'Good quality', 'Careful handling', 'Fresh items'];
const BAD = ['Late', 'Rude', 'Wrong items', 'Poor quality', 'Asked extra money'];
const WORD = ['', 'Very bad', 'Bad', 'Okay', 'Good', 'Excellent'];

export function Stars({ value, size = 'md' }) {
  return (
    <span className={`stars stars-${size}`} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= Math.round(value) ? 'on' : ''}>★</span>)}
    </span>
  );
}

export default function RateOrder({ order, who, onSaved }) {
  const r = order.rating;
  const [stars, setStars] = useState(r?.stars || 0);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState(r?.tags || []);
  const [comment, setComment] = useState(r?.comment || '');
  const [editing, setEditing] = useState(!r);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = !r || Date.now() - new Date(r.created_at) < 7 * 86400000;

  if (order.status !== 'delivered' || !order.agent_name) return null;

  if (r && !editing) {
    return (
      <section className="panel rate-card rated">
        <div className="rate-done">
          <div>
            <small className="muted">You rated {order.agent_name}</small>
            <div><Stars value={r.stars} /> <b>{WORD[r.stars]}</b></div>
            {r.tags?.length > 0 && <div className="rate-tags small">{r.tags.map((t) => <span key={t} className="tag-pill">{t}</span>)}</div>}
            {r.comment && <p className="small muted rate-comment">“{r.comment}”</p>}
          </div>
          {editable && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>}
        </div>
      </section>
    );
  }

  const shown = hover || stars;
  const options = stars && stars <= 3 ? BAD : GOOD;
  const toggle = (t) => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  const pick = (n) => {
    // switching between happy and unhappy clears tags that no longer fit
    if ((n <= 3) !== (stars <= 3)) setTags([]);
    setStars(n);
  };

  const save = async () => {
    if (!stars) return setError('Tap a star to rate');
    setBusy(true);
    setError('');
    try {
      await api(`/orders/${order.id}/rating`, { method: 'POST', body: { stars, tags: tags.filter((t) => options.includes(t)), comment } });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel rate-card">
      <h3>How was {order.agent_name}?</h3>
      <p className="muted small">Your rating helps us keep our {who}s great.</p>
      <div className="star-picker" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={n <= shown ? 'on' : ''}
            onMouseEnter={() => setHover(n)}
            onClick={() => pick(n)}
          >★</button>
        ))}
        <span className="star-word">{WORD[shown]}</span>
      </div>
      {stars > 0 && (
        <>
          <div className="rate-tags">
            {options.map((t) => (
              <button key={t} type="button" className={`tag-pill ${tags.includes(t) ? 'active' : ''}`} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>{t}</button>
            ))}
          </div>
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={stars <= 3 ? 'What went wrong? (optional)' : 'Anything to add? (optional)'} />
          <div className="rate-actions">
            {r && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Submit rating'}</button>
          </div>
        </>
      )}
      {error && <div className="alert">{error}</div>}
    </section>
  );
}
