const TOKEN_KEY = "livenew_token";
const DEVICE_KEY = "livenew_device";
let csrfToken = null;
let csrfPromise = null;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getDeviceName() {
  return localStorage.getItem(DEVICE_KEY);
}

export function setDeviceName(name) {
  if (name) localStorage.setItem(DEVICE_KEY, name);
}

export async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = fetch("/v1/csrf")
    .then((res) => res.json())
    .then((data) => {
      csrfToken = data?.token || null;
      return csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const deviceName = getDeviceName();
  if (deviceName) headers["x-device-name"] = deviceName;

  if (method !== "GET" && method !== "HEAD") {
    const csrf = await ensureCsrf();
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let body;
  if (options.body != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(path, { method, headers, body });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || payload?.ok === false) {
    const message = payload?.error?.message || payload?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export function apiGet(path) {
  return apiFetch(path, { method: "GET" });
}

export function apiPost(path, body) {
  return apiFetch(path, { method: "POST", body });
}

export function apiPatch(path, body) {
  return apiFetch(path, { method: "PATCH", body });
}

export function apiDelete(path, body) {
  return apiFetch(path, { method: "DELETE", body });
}

export function requestAuth(email) {
  return apiPost("/v1/auth/request", { email });
}

export function verifyAuth(email, code) {
  return apiPost("/v1/auth/verify", { email, code });
}

export function refreshAuth() {
  return apiPost("/v1/auth/refresh", {});
}

