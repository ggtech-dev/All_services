import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthLayout from './AuthLayout.jsx';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', phone: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const { confirm, ...payload } = form;
      await register({ ...payload, username: payload.username.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="It takes less than a minute">
      <form onSubmit={onSubmit} className="form">
        <div className="form-row">
          <label>Full name<input value={form.fullName} onChange={set('fullName')} placeholder="Your name" /></label>
          <label>Phone<input value={form.phone} onChange={set('phone')} placeholder="10-digit mobile" inputMode="tel" /></label>
        </div>
        <label>Username<input value={form.username} onChange={set('username')} autoComplete="username" placeholder="Choose a username" required /></label>
        <div className="form-row">
          <label>Password<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Min 6 characters" required /></label>
          <label>Confirm<input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" placeholder="Repeat password" required /></label>
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="switch">Already have an account? <Link to="/login">Login</Link></p>
    </AuthLayout>
  );
}
