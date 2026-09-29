import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api.js';
import { ToastProvider } from '../admin/ui.jsx';
import { StateBadge, usePoll } from '../orderStatus.jsx';
import { useLiveLocation } from './useLiveLocation.js';
import { useAuth } from '../auth.jsx';

// Mobile-first shell for delivery agents: header with online state, bottom tab bar.
export default function AgentLayout() {
  const { logout } = useAuth();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => api('/agent/me').then(setMe).catch((e) => setError(e.message)), []);
  useEffect(() => {
    reload();
  }, [reload]);
  usePoll(reload, 20000);
  // GPS is shared only while the agent is online (on duty).
  const location = useLiveLocation(!!me?.agent.is_online);

  if (error) return <div className="center-screen"><div className="alert">{error}</div></div>;
  if (!me) return <div className="center-screen"><div className="spinner" /></div>;

  return (
    <ToastProvider>
      <div className="agent-app">
        <header className="agent-top">
          <div className="agent-who">
            <div className="agent-avatar small">{me.agent.full_name[0]}</div>
            <div>
              <b>{me.agent.full_name}</b>
              <StateBadge state={me.agent.state} />
            </div>
          </div>
          <button
            className="agent-logout"
            onClick={async () => {
              if (me.agent.is_online) {
                if (!confirm('You are online. Log out anyway? You will go offline and stop getting orders.')) return;
                // Go offline first so the admin doesn't see a logged-out agent as "free".
                await api('/agent/status', { method: 'PATCH', body: { online: false } }).catch(() => {});
              }
              logout();
            }}
          >
            ⎋ Logout
          </button>
        </header>
        <main className="agent-main">
          <Outlet context={{ me, reload, location }} />
        </main>
        <nav className="agent-tabs">
          <NavLink to="/agent" end><span>🏠</span>Home</NavLink>
          <NavLink to="/agent/orders"><span>📦</span>My orders</NavLink>
          <NavLink to="/agent/wallet"><span>💰</span>Wallet</NavLink>
          <NavLink to="/agent/profile"><span>👤</span>Profile</NavLink>
        </nav>
      </div>
    </ToastProvider>
  );
}
