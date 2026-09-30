const TOKEN_KEY = 'as_token';

// Storage can be unavailable (private mode, blocked site data): never let that break the app.
const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

// Each browser tab keeps its own login (sessionStorage), so admin, agent and customer can be open side by side
// without one tab's login replacing another's. The most recent login is also kept in localStorage, so a newly
// opened tab (or the next visit) starts logged in; the tab then adopts it as its own.
export const getToken = () => {
  const mine = safe(() => sessionStorage.getItem(TOKEN_KEY));
  if (mine) return mine;
  const last = safe(() => localStorage.getItem(TOKEN_KEY));
  if (last) safe(() => sessionStorage.setItem(TOKEN_KEY, last));
  return last;
};

export const setToken = (t) => {
  if (t) {
    safe(() => sessionStorage.setItem(TOKEN_KEY, t));
    safe(() => localStorage.setItem(TOKEN_KEY, t));
    return;
  }
  // Logging out of this tab: forget this tab's login, and the saved one only if it is the same account.
  const mine = safe(() => sessionStorage.getItem(TOKEN_KEY));
  safe(() => sessionStorage.removeItem(TOKEN_KEY));
  if (!mine || safe(() => localStorage.getItem(TOKEN_KEY)) === mine) safe(() => localStorage.removeItem(TOKEN_KEY));
};

// Tells the AuthProvider that the server rejected our login (expired / wrong role), so it can re-check.
export const AUTH_PROBLEM = 'as:auth-problem';

export async function api(path, { method = 'GET', body } = {}) {
  const isForm = body instanceof FormData;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (token && (res.status === 401 || (res.status === 403 && data.error === 'Forbidden'))) {
      window.dispatchEvent(new CustomEvent(AUTH_PROBLEM, { detail: res.status }));
    }
    const err = new Error(res.status === 401 && token ? 'Your session has ended. Please log in again.' : data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Fetches a protected file (e.g. an agent's Aadhaar scan) and returns { url, type } for <img>/<a>.
export async function apiFile(path) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load file');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  return (await api('/admin/upload', { method: 'POST', body: form })).url;
}

export const formatPrice = (p, unit) =>
  Number(p) > 0 ? `₹${Number(p).toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}` : unit || 'Free';

export const formatEta = (m) =>
  m == null ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} day`;
