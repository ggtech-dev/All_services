import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { timeAgo, useLoad } from './ui.jsx';
import { describeActivity } from './Activity.jsx';

export default function Dashboard() {
  const stats = useLoad(() => api('/admin/stats'));
  const activity = useLoad(() => api('/admin/activity?limit=8'));

  if (stats.loading) return <div className="center-block"><div className="spinner" /></div>;
  if (stats.error) return <div className="alert">{stats.error}</div>;
  const s = stats.data;
  const maxTotal = Math.max(1, ...s.per_category.map((c) => c.total));

  const tiles = [
    { label: 'Live services', value: s.active_services, sub: `${s.services - s.active_services} hidden`, icon: '🧰', to: '/admin/services' },
    { label: 'Products', value: s.active_products, sub: `${s.out_of_stock} out of stock`, icon: '🛍️', to: '/admin/products' },
    { label: 'Categories', value: s.active_categories, sub: `${s.categories - s.active_categories} hidden`, icon: '🗂️', to: '/admin/categories' },
    { label: 'Customers', value: s.customers, sub: `${s.partners} partners`, icon: '👥' },
    { label: 'Avg. price', value: `₹${Number(s.avg_price || 0).toLocaleString('en-IN')}`, sub: `${s.price_changes_7d} price changes this week`, icon: '₹', to: '/admin/pricing' },
  ];

  return (
    <div className="stack">
      <div className="stat-grid">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="stat-icon">{t.icon}</span>
              <div>
                <div className="stat-label">{t.label}</div>
                <div className="stat-value">{t.value}</div>
                <div className="stat-sub">{t.sub}</div>
              </div>
            </>
          );
          return t.to ? <Link key={t.label} to={t.to} className="stat-tile">{body}</Link> : <div key={t.label} className="stat-tile">{body}</div>;
        })}
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h3>Services by category</h3><Link to="/admin/services" className="link">Manage →</Link></div>
          <div className="bars">
            {s.per_category.map((c) => (
              <div key={c.name} className="bar-row">
                <span className="bar-label">{c.icon} {c.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.active / maxTotal) * 100}%`, background: c.color }} />
                </div>
                <span className="bar-value">{c.active}{c.total !== c.active && <small> / {c.total}</small>}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Recent changes</h3><Link to="/admin/activity" className="link">All activity →</Link></div>
          {activity.data?.length ? (
            <ul className="activity-list">
              {activity.data.map((a) => (
                <li key={a.id}>
                  <span className={`dot dot-${a.action}`} />
                  <div>
                    <div>{describeActivity(a)}</div>
                    <small className="muted">{a.actor || 'system'} · {timeAgo(a.created_at)}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No changes yet. Edits you make in the admin panel will show up here.</p>
          )}
        </section>
      </div>

      <section className="panel quick-actions">
        <h3>Quick actions</h3>
        <div className="quick-grid">
          <Link to="/admin/services?new=1" className="quick">➕ Add a service</Link>
          <Link to="/admin/products?new=1" className="quick">🛍️ Add a product</Link>
          <Link to="/admin/pricing" className="quick">📈 Change prices in bulk</Link>
          <Link to="/admin/settings" className="quick">📝 Edit home banner</Link>
        </div>
      </section>
    </div>
  );
}
