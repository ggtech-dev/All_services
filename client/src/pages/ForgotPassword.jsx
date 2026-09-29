import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthLayout from './AuthLayout.jsx';
import EmailCode from '../components/EmailCode.jsx';

// Forgot password: email → 6-digit code + new password → done.
export default function ForgotPassword() {
  const [params] = useSearchParams();
  const asAgent = params.get('as') === 'agent';
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const loginLink = `/login${asAgent ? '?as=agent' : ''}`;

  return (
    <AuthLayout title={done ? 'Password changed ✅' : 'Forgot password?'} subtitle={done ? 'You can now log in with your new password.' : "We'll email you a code to set a new password."}>
      {done ? (
        <div className="form">
          <Link className="btn btn-primary btn-center" to={loginLink}>Go to login</Link>
        </div>
      ) : (
        <EmailCode
          requestPath="/auth/password/forgot"
          emailLabel="Email on your account"
          submitLabel="Set new password"
          onCode={async (email, code) => {
            if (pw.password !== pw.confirm) throw new Error('The two passwords do not match');
            await api('/auth/password/reset', { method: 'POST', body: { email, code, password: pw.password } });
            setDone(true);
          }}
        >
          <div className="form-row">
            <label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} placeholder="Min 6 characters" required minLength={6} /></label>
            <label>Confirm<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="Repeat password" required /></label>
          </div>
        </EmailCode>
      )}
      {!done && <p className="switch">Remembered it? <Link to={loginLink}>Back to login</Link></p>}
    </AuthLayout>
  );
}
