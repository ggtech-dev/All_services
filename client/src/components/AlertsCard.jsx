import { useState } from 'react';
import { useAlerts } from '../alerts.js';
import { isIOS, isStandalone } from '../pwa.js';

// "Order alerts" card: turn on phone notifications + sound. who = 'agent' (new orders) or 'customer' (order updates).
export default function AlertsCard({ who = 'agent', compact = false }) {
  const a = useAlerts();
  const [tested, setTested] = useState('');
  const on = a.permission === 'granted';
  const text = who === 'agent'
    ? { title: 'Turn on order alerts', why: 'Get a sound and a phone notification for every new order — even when the app is in the background.', on: 'Order alerts are on' }
    : { title: 'Get order updates on your phone', why: 'We’ll tell you when your order is accepted, on the way and delivered.', on: 'Order updates are on' };

  if (on && compact) return null; // nothing to do — keep the screen clean

  const test = async () => {
    setTested('');
    const sent = await a.test();
    setTested(sent ? 'Sent — you should see a notification now.' : 'Sound played. Phone notifications need the installed app (or the https link).');
  };

  if (on) {
    return (
      <section className="panel alerts-card is-on">
        <div className="alerts-head">
          <span className="alerts-icon" aria-hidden="true">🔔</span>
          <div>
            <b>{text.on}</b>
            <small className="muted">{a.push ? 'Sound + phone notifications on this device.' : 'Sound and on-screen alerts while the app is open.'}</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={test}>Test</button>
        </div>
        {tested && <small className="muted">{tested}</small>}
      </section>
    );
  }

  const iosNeedsInstall = isIOS() && !isStandalone();
  return (
    <section className="panel alerts-card">
      <div className="alerts-head">
        <span className="alerts-icon ring" aria-hidden="true">🔔</span>
        <div>
          <b>{text.title}</b>
          <small className="muted">{text.why}</small>
        </div>
      </div>
      {a.permission === 'denied' ? (
        <p className="small alerts-blocked">
          Notifications are blocked for this site. Tap the 🔒 next to the address → <b>Permissions</b> → <b>Notifications: Allow</b>, then reload.
        </p>
      ) : iosNeedsInstall ? (
        <p className="small muted">On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), open it from there, then turn alerts on.</p>
      ) : (
        <button className="btn btn-primary btn-block" onClick={a.enable} disabled={a.busy}>
          {a.busy ? 'Turning on…' : '🔔 Turn on alerts'}
        </button>
      )}
      {a.error && <p className="small alerts-blocked">{a.error}</p>}
    </section>
  );
}
