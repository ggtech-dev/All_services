const TOKEN_KEY = 'as_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

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
    const err = new Error(data.error || `Request failed (${res.status})`);
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
