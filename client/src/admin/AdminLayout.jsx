import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { usePoll } from '../orderStatus.jsx';
import { ToastProvider } from './ui.jsx';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/admin/orders', label: 'Manage orders', icon: '📦', badge: 'waiting' },
  { to: '/admin/agents', label: 'Manage agents', icon: '🛵', badge: 'pending_applications' },
  { to: '/admin/service-types', label: 'Agent types', icon: '🧩' },
  { to: '/admin/services', label: 'Services', icon: '🧰' },
  { to: '/admin/products', label: 'Products', icon: '🛍️' },
  { to: '/admin/categories', label: 'Categories', icon: '🗂️' },
  { to: '/admin/pricing', label: 'Prices & items', icon: '₹' },
  { to: '/admin/settings', label: 'Site settings', icon: '⚙️' },
  { to: '/admin/activity', label: 'Activity log', icon: '🕘' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  // Sidebar badges: orders waiting for an agent, agent applications to review.
  const [counts, setCounts] = useState({});
  const loadCounts = () => api('/admin/orders-stats').then(setCounts).catch(() => {});
  useEffect(() => {
    loadCounts();
  }, []);
  usePoll(loadCounts, 20000);

  const current = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  return (
    <ToastProvider>
      <div className={`admin ${open ? 'nav-open' : ''}`}>
        <aside className="admin-sidebar">
          <Link to="/admin" className="brand admin-brand">
            <span className="brand-logo">AS</span>
            <span>All Services <small>Admin</small></span>
          </Link>
          <nav onClick={() => setOpen(false)}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="admin-nav-link">
                <span className="admin-nav-icon">{n.icon}</span> {n.label}
                {n.badge && counts[n.badge] > 0 && <span className="nav-badge">{counts[n.badge]}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="admin-sidebar-foot">
            <Link to="/" className="admin-nav-link"><span className="admin-nav-icon">👁️</span> View customer app</Link>
          </div>
        </aside>
        <div className="admin-scrim" onClick={() => setOpen(false)} />

        <div className="admin-main">
          <header className="admin-topbar">
            <button className="icon-btn admin-menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
            <h2>{current?.label || 'Admin'}</h2>
            <div className="nav-right">
              <span className="nav-user">🛡️ <b>{user.fullName || user.username}</b></span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
            </div>
          </header>
          <div className="admin-content">
            <Outlet />
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
