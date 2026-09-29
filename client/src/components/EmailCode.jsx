import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Two-step "send code to email → type the code" block, used for login, forgot password and email changes.
//   requestPath: API that emails the code (body: { email, ...extra })
//   onCode(email, code): called with the typed code; should throw an Error with a message on failure
//   children(code): optional extra fields shown next to the code (e.g. new password)
export default function EmailCode({ requestPath, extra = {}, initialEmail = '', emailLabel = 'Email', submitLabel, onCode, children, lockEmail = false }) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [code, setCode] = useState('');
  const [info, setInfo] = useState(null); // response from requestPath
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api(requestPath, { method: 'POST', body: { email: email.trim(), ...extra } });
      setInfo(d);
      setStep('code');
      setCode('');
      setWait(30);
    } catch (err) {
      setError(err.message);
      const secs = err.message.match(/wait (\d+) seconds/);
      if (secs) {
        setStep('code');
        setWait(Number(secs[1]));
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onCode(email.trim(), code.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (step === 'email') {
    return (
      <form className="form" onSubmit={send}>
        <label>
          {emailLabel}
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus={!lockEmail} readOnly={lockEmail} />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send 6-digit code'}</button>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={verify}>
      <p className="code-sent">
        {info?.message || 'We sent a code.'} It is valid for {info?.minutes || 10} minutes. Check your spam folder too.
        <br /><span className="muted">{email}</span>{' '}
        {!lockEmail && <button type="button" className="link-btn" onClick={() => { setStep('email'); setError(''); }}>Change</button>}
      </p>
      {info?.devCode && (
        <div className="test-code">🧪 Test mode (email not set up yet): your code is <b>{info.devCode}</b></div>
      )}
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
      {children}
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : submitLabel}</button>
      <button type="button" className="link-btn resend" disabled={wait > 0 || busy} onClick={send}>
        {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
      </button>
    </form>
  );
}
