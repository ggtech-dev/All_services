import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import EmailCode from './EmailCode.jsx';

// Email (add / change with a verification code) and password change. Used on the customer Account page
// and in the agent app Profile tab.
export default function AccountSecurity() {
  const { user, setUser } = useAuth();
  const [changingEmail, setChangingEmail] = useState(!user.email);
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.password !== pw.confirm) return setPwMsg({ error: 'The two new passwords do not match' });
    setBusy(true);
    try {
      await api('/auth/password/change', { method: 'POST', body: { current: pw.current, password: pw.password } });
      setPw({ current: '', password: '', confirm: '' });
      setPwMsg({ ok: 'Password changed ✅' });
    } catch (err) {
      setPwMsg({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-grid">
      <section className="panel">
        <h3>📧 Email</h3>
        <p className="muted small">Used to log in with a code and to reset your password.</p>
        {user.email && !changingEmail && (
          <div className="email-row">
            <b>{user.email}</b>
            {user.emailVerified ? <span className="verified">✓ Verified</span> : <span className="unverified">Not verified yet</span>}
            <button className="link-btn" onClick={() => setChangingEmail(true)}>Change</button>
          </div>
        )}
        {changingEmail && (
          <>
            {!user.email && <div className="gap-alert small">Add your email so you can log in with a code and recover your account.</div>}
            <EmailCode
              requestPath="/auth/email/request"
              emailLabel={user.email ? 'New email' : 'Your email'}
              submitLabel="Confirm email"
              onCode={async (email, code) => {
                const d = await api('/auth/email/verify', { method: 'POST', body: { email, code } });
                setUser(d.user);
                setChangingEmail(false);
              }}
            />
            {user.email && <button className="link-btn" onClick={() => setChangingEmail(false)}>Cancel</button>}
          </>
        )}
      </section>

      <section className="panel">
        <h3>🔑 Change password</h3>
        <form className="form" onSubmit={changePassword}>
          <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
          <div className="form-row">
            <label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required minLength={6} placeholder="Min 6 characters" /></label>
            <label>Confirm<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></label>
          </div>
          {pwMsg?.error && <div className="alert">{pwMsg.error}</div>}
          {pwMsg?.ok && <div className="ok-msg">{pwMsg.ok}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          <small className="muted">Forgot your current password? Log out and use “Forgot password?” on the login page.</small>
        </form>
      </section>
    </div>
  );
}
