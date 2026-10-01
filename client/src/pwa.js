import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

// Installable app (PWA): service worker + the browser's "install" prompt.
// The prompt event fires once, early — it is captured here at start-up and offered later from a button.
registerSW({ immediate: true });

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own "Install app" button instead of the browser's mini-bar
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPhone / iPad have no install prompt: people use Share → "Add to Home Screen" in Safari
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const installed = isStandalone();
  return {
    installed,
    // Android / Chrome / Edge on laptops: one tap
    canPrompt: !installed && !!deferred,
    // iPhone: show the two steps
    iosSteps: !installed && !deferred && isIOS(),
    prompt: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      notify();
      e.prompt();
      const { outcome } = await e.userChoice;
      return outcome === 'accepted';
    },
  };
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
