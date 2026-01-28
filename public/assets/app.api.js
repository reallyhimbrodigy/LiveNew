const ACCESS_KEY = "livenew_access_token";
const REFRESH_KEY = "livenew_refresh_token";
const LEGACY_KEY = "livenew_token";
const DEVICE_KEY = "livenew_device";
let csrfToken = null;
let csrfPromise = null;

export function getToken() {
  const current = localStorage.getItem(ACCESS_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    localStorage.setItem(ACCESS_KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
    return legacy;
  }
  return null;
}

export function setToken(token) {
  if (token) localStorage.setItem(ACCESS_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
}

export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_KEY);
}

export function clearTokens() {
  clearToken();
  clearRefreshToken();
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
  let token = getToken();
  if (!token && getRefreshToken() && !options._skipRefresh && !path.startsWith("/v1/auth/")) {
    try {
      const refreshed = await refreshAuth();
      const nextAccess = refreshed?.accessToken || refreshed?.token;
      if (nextAccess) {
        setToken(nextAccess);
        if (refreshed?.refreshToken) setRefreshToken(refreshed.refreshToken);
        token = nextAccess;
      }
    } catch {
      clearTokens();
    }
  }
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
  if (res.status === 401 && !options._retried && getRefreshToken()) {
    try {
      const refreshed = await refreshAuth();
      const nextAccess = refreshed?.accessToken || refreshed?.token;
      if (nextAccess) {
        setToken(nextAccess);
        if (refreshed?.refreshToken) setRefreshToken(refreshed.refreshToken);
        return apiFetch(path, { ...options, _retried: true, _skipRefresh: true });
      }
    } catch {
      clearTokens();
    }
  }
  if (!res.ok || payload?.ok === false) {
    const errorPayload = payload?.error || {};
    const message = errorPayload.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.code = errorPayload.code || "http_error";
    err.httpStatus = res.status;
    err.requestId = errorPayload.requestId || null;
    err.details = payload?.details || errorPayload.details || null;
    err.required = errorPayload.required || null;
    err.requiredVersion = errorPayload.requiredVersion || null;
    err.userVersion = errorPayload.userVersion || null;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export function apiGet(path, options = {}) {
  return apiFetch(path, { method: "GET", headers: options.headers });
}

export function apiPost(path, body, options = {}) {
  return apiFetch(path, { method: "POST", body, headers: options.headers });
}

export function apiPatch(path, body, options = {}) {
  return apiFetch(path, { method: "PATCH", body, headers: options.headers });
}

export function apiDelete(path, body, options = {}) {
  return apiFetch(path, { method: "DELETE", body, headers: options.headers });
}

export function requestAuth(email) {
  return apiPost("/v1/auth/request", { email });
}

export function verifyAuth(email, code) {
  return apiPost("/v1/auth/verify", { email, code });
}

export function refreshAuth() {
  return apiPost("/v1/auth/refresh", { refreshToken: getRefreshToken() });
}

export function logoutAuth() {
  return apiPost("/v1/auth/logout", { refreshToken: getRefreshToken() });
}
