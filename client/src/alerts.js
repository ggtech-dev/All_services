import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { usePoll } from './orderStatus.jsx';

// Order alerts: phone notifications (web push, works with the app closed) + a sound and vibration while it is open.

// ---------- sound (made in the browser — no audio file to download) ----------
let ctx = null;
const audio = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
};
// Browsers only allow sound after the person has tapped something once: unlock on the first tap.
const unlock = () => {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
};
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, passive: true }));

export function playChime(times = 2) {
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const notes = [880, 1175, 1568]; // A5 – D6 – G6: short, bright, easy to hear on a phone speaker
  for (let r = 0; r < times; r++) {
    notes.forEach((f, i) => {
      const t = c.currentTime + r * 0.9 + i * 0.16;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  }
  navigator.vibrate?.([300, 120, 300, 120, 600]);
}

// Each alert rings once, whether we heard about it from the push or from the app's own refresh.
// key: 'new-<order id>' or 'assigned-<order id>'
const rung = new Set();
let pushOn = false; // this device gets web push for the logged-in user
export function ringFor(key) {
  if (rung.has(key)) return false;
  rung.add(key);
  playChime();
  return true;
}

// ---------- phone notifications (web push) ----------
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const permission = () => (!('Notification' in window) ? 'unsupported' : Notification.permission);

// base64url → bytes (the server's public key)
const keyBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
};

// The service worker exists only in the installed/built app (not on the :5173 dev server).
async function registration() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return null;
  if (reg.active) return reg;
  return (await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))])) || null;
}

async function subscribe() {
  const reg = await registration();
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api('/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  pushOn = true;
  return true;
}

// After login: if this device already allowed notifications, make sure the server has it for this user.
export async function syncPush() {
  if (permission() !== 'granted') return false;
  return subscribe().catch(() => false);
}

// On logout: this device stops getting the previous user's alerts.
export async function dropPush() {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
    pushOn = false;
  } catch {
    /* nothing to undo */
  }
}

// For the "Order alerts" card.
export function useAlerts() {
  const [state, setState] = useState({ permission: permission(), push: null, busy: false, error: '' });
  useEffect(() => {
    let alive = true;
    (async () => {
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (sub) pushOn = true;
      if (alive) setState((s) => ({ ...s, push: Boolean(sub) }));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: '' }));
    unlock();
    try {
      if (!('Notification' in window)) throw new Error('This browser cannot show notifications. Install the app from Chrome.');
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser’s site settings (🔒 next to the address).');
      const ok = await subscribe();
      setState({ permission: p, push: ok, busy: false, error: '' });
      playChime(1);
      return ok;
    } catch (e) {
      setState((s) => ({ ...s, permission: permission(), busy: false, error: e.message }));
      return false;
    }
  }, []);

  const test = useCallback(async () => {
    playChime(1);
    const r = await api('/push/test', { method: 'POST' }).catch(() => ({ sent: 0 }));
    if (!r.sent && permission() === 'granted') new Notification('🔔 Alerts are on', { body: 'Sound and notifications work on this device.', icon: '/icons/icon-192.png' });
    return r.sent;
  }, []);

  return { ...state, supported: supported(), enable, test };
}

// ---------- agent: watch for new orders anywhere in the agent app ----------
// Rings and vibrates for each new order. If the page is hidden and this device has no push, shows a notification.
export function useNewOrderWatch(online) {
  const seen = useRef(null);
  const check = useCallback(async () => {
    const list = await api('/agent/available');
    if (seen.current) {
      const fresh = list.filter((o) => !seen.current.has(o.id));
      fresh.forEach((o) => {
        // a hidden page with no push on this device: show the notification from here
        if (ringFor(`new-${o.id}`) && document.hidden && !pushOn && permission() === 'granted') {
          new Notification(`🔔 New order #${o.id} · ${o.locality_name}`, { body: o.summary || '', icon: '/icons/icon-192.png', tag: `order-${o.id}` });
        }
      });
    } else {
      list.forEach((o) => rung.add(`new-${o.id}`)); // orders already waiting when the app opened don't ring
    }
    seen.current = new Set(list.map((o) => o.id));
  }, []);

  useEffect(() => {
    seen.current = null;
    if (online) check().catch(() => {});
  }, [online, check]);
  usePoll(() => check().catch(() => {}), 10000, online);

  // push arrived while the app is open → ring now (the refresh will find the order next)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMsg = (e) => {
      const d = e.data?.data;
      if (e.data?.type !== 'push' || !d) return;
      const id = Number(String(d.tag || '').replace('order-', ''));
      if (d.kind === 'new_order') ringFor(`new-${id}`);
      if (d.kind === 'assigned') ringFor(`assigned-${id}`);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);
}
