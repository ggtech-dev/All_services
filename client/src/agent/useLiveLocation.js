import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SEND_EVERY_MS = 10000;

// While `enabled` (agent is online), watch the phone's GPS and send it to the server every ~10 s.
// Returns { status: 'off' | 'waiting' | 'on' | 'denied' | 'unavailable', accuracy, lastSent }.
export function useLiveLocation(enabled) {
  const [state, setState] = useState({ status: 'off', accuracy: null, lastSent: null });
  const lastSent = useRef(0);
  const latest = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off', accuracy: null, lastSent: null });
      return undefined;
    }
    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable', accuracy: null, lastSent: null });
      return undefined;
    }
    setState((s) => ({ ...s, status: 'waiting' }));

    let pending = null;
    const send = async (force = false) => {
      const p = latest.current;
      if (!p) return;
      const wait = SEND_EVERY_MS - (Date.now() - lastSent.current);
      if (!force && wait > 0) {
        // Too soon: send the newest position as soon as the 10 s are up, instead of dropping it.
        if (!pending) pending = setTimeout(() => { pending = null; send(); }, wait);
        return;
      }
      lastSent.current = Date.now();
      try {
        await api('/agent/location', { method: 'POST', body: p });
        setState({ status: 'on', accuracy: p.accuracy, lastSent: new Date() });
      } catch {
        /* network hiccup: the next position update will retry */
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        send();
      },
      (err) => setState({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable', accuracy: null, lastSent: null }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    // If the agent stands still the phone may not report new positions: re-send the last one periodically.
    const keepAlive = setInterval(() => send(true), SEND_EVERY_MS * 3);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(keepAlive);
      clearTimeout(pending);
    };
  }, [enabled]);

  return state;
}
