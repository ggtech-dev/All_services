import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthLayout from './AuthLayout.jsx';

const PORTALS = {
  user: { label: 'User', icon: '👤', title: 'Welcome back 👋', subtitle: 'Log in to book your next service', button: 'Login' },
  admin: { label: 'Admin', icon: '🛡️', title: 'Admin login', subtitle: 'Manage services, prices and the customer app', button: 'Login to admin panel' },
};

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const portal = params.get('as') === 'admin' ? 'admin' : 'user';
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />;

  const p = PORTALS[portal];
  const choose = (next) => {
    setError('');
    setParams(next === 'admin' ? { as: 'admin' } : {}, { replace: true });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.username.trim(), form.password, portal);
      navigate(portal === 'admin' ? '/admin' : location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={p.title} subtitle={p.subtitle}>
      <div className="portal-switch" role="tablist" aria-label="Login as">
        {Object.entries(PORTALS).map(([key, v]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={portal === key}
            className={portal === key ? 'active' : ''}
            onClick={() => choose(key)}
          >
            <span>{v.icon}</span> {v.label}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="form">
        <label>
          Username
          <input
            autoFocus
            autoComplete="username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder={portal === 'admin' ? 'Admin username' : 'Enter your username'}
            required
          />
        </label>
        <label>
          Password
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter your password"
              required
            />
            <button type="button" className="link-btn" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        {error && <div className="alert">{error}</div>}
        <button className={`btn btn-primary ${portal === 'admin' ? 'btn-dark' : ''}`} disabled={busy}>
          {busy ? 'Logging in…' : p.button}
        </button>
      </form>
      {portal === 'user' ? (
        <p className="switch">New here? <Link to="/register">Create an account</Link></p>
      ) : (
        <p className="switch">Admin accounts are created by the system owner.</p>
      )}
    </AuthLayout>
  );
}
