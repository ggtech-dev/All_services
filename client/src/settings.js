import { useEffect, useState } from 'react';
import { api } from './api.js';

// Public site settings (city, support phone, company UPI QR…). Loaded once per page load;
// the admin pages call loadSettings(true) after saving so every screen sees the change.
let cache = null;
let pending = null;

export function loadSettings(fresh = false) {
  if (fresh || !pending) {
    pending = api('/settings')
      .then((s) => (cache = s))
      .catch(() => {
        pending = null;
        return cache || {};
      });
  }
  return pending;
}

export function useSettings() {
  const [settings, setSettings] = useState(cache || {});
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

export const cityOf = (s) => s?.service_city || 'Siddipet, Telangana';
