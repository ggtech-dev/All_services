import { Link } from 'react-router-dom';

// Grey placeholder shapes shown while a page loads (instead of a lone spinner), so the layout doesn't jump.
// variant: 'grid' (category/service cards) · 'list' (order rows) · 'page' (title + panels) · 'shop' (product cards)
export default function Skeleton({ variant = 'list', count }) {
  if (variant === 'grid' || variant === 'shop') {
    const n = count || (variant === 'shop' ? 8 : 6);
    return (
      <div className={variant === 'shop' ? 'sk-shop' : 'sk-grid'} aria-busy="true" aria-label="Loading">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="sk-card">
            <div className="sk sk-img" />
            <div className="sk sk-line w70" />
            <div className="sk sk-line w40" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'page') {
    return (
      <div className="sk-page" aria-busy="true" aria-label="Loading">
        <div className="sk sk-title" />
        <div className="sk-panel"><div className="sk sk-line w60" /><div className="sk sk-line w90" /><div className="sk sk-line w40" /></div>
        <div className="sk-panel"><div className="sk sk-line w80" /><div className="sk sk-line w50" /></div>
      </div>
    );
  }
  return (
    <div className="sk-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count || 4 }, (_, i) => (
        <div key={i} className="sk-row">
          <div className="sk sk-dot" />
          <div className="sk-row-main"><div className="sk sk-line w60" /><div className="sk sk-line w90" /></div>
          <div className="sk sk-chip" />
        </div>
      ))}
    </div>
  );
}

// Friendly "nothing here" block with an optional action.
export function EmptyState({ icon = '📭', title, text, action, to, onClick, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      {title && <h2>{title}</h2>}
      {text && <p className="muted">{text}</p>}
      {action && to && <Link to={to} className="btn btn-primary">{action}</Link>}
      {action && onClick && <button type="button" className="btn btn-primary" onClick={onClick}>{action}</button>}
    </div>
  );
}
