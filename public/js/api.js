/* Tiny API client — keeps the auth token and normalises errors. */

const TOKEN_KEY = 'pf_token';
const USER_KEY = 'pf_user';
const DRAFT_KEY = 'pf_draft';
const LAST_KEY = 'pf_last_submission';
const DEVICE_KEY = 'pf_device';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const store = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  get draft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
    catch { return null; }
  },
  set draft(value) {
    if (value) localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    else localStorage.removeItem(DRAFT_KEY);
  },
  get lastSubmission() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); }
    catch { return null; }
  },
  set lastSubmission(value) { localStorage.setItem(LAST_KEY, JSON.stringify(value)); },
  /**
   * Stable id for this browser, sent with every upload so the server can
   * enforce "one entry per participant" even if the form is retyped by hand.
   */
  get deviceId() {
    let id = localStorage.getItem(DEVICE_KEY) || '';
    if (!id) {
      id = (typeof crypto.randomUUID === 'function' && crypto.randomUUID())
        || `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  },
};

async function request(path, options = {}) {
  const headers = {};
  if (store.token) headers.Authorization = `Bearer ${store.token}`;

  let body = options.body;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers,
      body,
      signal: options.signal,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is Promptify still running?', 0);
  }

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    if (res.status === 401 && store.token) store.clear();
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', formData }),
};

/** Cached once per page load — departments, AI tools, scoring rubric, … */
let metaPromise = null;
export function getMeta() {
  if (!metaPromise) metaPromise = request('/meta');
  return metaPromise;
}

export function qs(params = {}) {
  const clean = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return clean.length ? `?${clean.join('&')}` : '';
}
