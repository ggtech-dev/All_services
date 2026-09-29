import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import AuthLayout from './AuthLayout.jsx';

// Sign-up in two steps: details → 6-digit code sent to the email → account created with a verified email.
export default function Register() {
  const { user, completeRegistration } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', username: '', password: '', confirm: '' });
  const [step, setStep] = useState('details'); // 'details' | 'code'
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (user) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const sendCode = async (e) => {
    e?.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const { confirm, ...payload } = form;
      const d = await api('/auth/register/start', {
        method: 'POST',
        body: { ...payload, username: payload.username.trim(), email: payload.email.trim() },
      });
      setInfo(d);
      setCode('');
      setStep('code');
      setWait(30);
    } catch (err) {
      setError(err.message);
      const secs = err.message.match(/wait (\d+) seconds/);
      if (secs && step === 'code') setWait(Number(secs[1]));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await completeRegistration(form.email.trim(), code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <AuthLayout title="Check your email 📧" subtitle="One last step to create your account">
        <form className="form" onSubmit={verify}>
          <p className="code-sent">
            {info?.message} It is valid for {info?.minutes || 10} minutes. Check your spam folder too.{' '}
            <button type="button" className="link-btn" onClick={() => { setStep('details'); setError(''); }}>Change details</button>
          </p>
          {info?.devCode && <div className="test-code">🧪 Test mode (email not set up yet): your code is <b>{info.devCode}</b></div>}
          <label>
            6-digit code
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              required
              autoFocus
            />
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? 'Creating…' : 'Verify & create account'}</button>
          <button type="button" className="link-btn resend" disabled={wait > 0 || busy} onClick={sendCode}>
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="It takes less than a minute">
      <form onSubmit={sendCode} className="form">
        <div className="form-row">
          <label>Full name<input value={form.fullName} onChange={set('fullName')} placeholder="Your name" /></label>
          <label>Phone<input value={form.phone} onChange={set('phone')} placeholder="10-digit mobile" inputMode="tel" /></label>
        </div>
        <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com — we'll send a code to confirm it" required /></label>
        <label>Username<input value={form.username} onChange={set('username')} autoComplete="username" placeholder="Choose a username" required /></label>
        <div className="form-row">
          <label>Password<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Min 6 characters" required /></label>
          <label>Confirm<input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" placeholder="Repeat password" required /></label>
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending code…' : 'Continue — send code to my email'}</button>
      </form>
      <p className="switch">Already have an account? <Link to="/login">Login</Link></p>
    </AuthLayout>
  );
}
