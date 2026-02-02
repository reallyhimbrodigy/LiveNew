const ACCESS_KEY = "livenew_access_token";
const REFRESH_KEY = "livenew_refresh_token";
const LEGACY_KEY = "livenew_token";
const DEVICE_KEY = "livenew_device";
let csrfToken = null;
let csrfPromise = null;
const IS_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

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

function isJsonResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json");
}

function extractRequestId(payload, res) {
  return (
    payload?.requestId ||
    payload?.error?.requestId ||
    res.headers.get("x-request-id") ||
    res.headers.get("x-requestid") ||
    null
  );
}

async function parseJsonResponse(res) {
  if (!isJsonResponse(res)) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function ensureCsrf() {
  if (!IS_BROWSER) return null;
  if (csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = apiFetch("/v1/csrf", { method: "GET", _skipRefresh: true, _skipRetry: true })
    .then((data) => {
      csrfToken = data?.token || null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

function shouldRetry({ method, idempotent }, resOrStatus, retried) {
  if (retried) return false;
  const isMutating = !(method === "GET" || method === "HEAD");
  if (isMutating && !idempotent) return false;
  const status = typeof resOrStatus === "number" ? resOrStatus : resOrStatus?.status;
  if (status == null) return true;
  return status === 502 || status === 503 || status === 504;
}

export async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  const idempotent = options.idempotent === true;

  let token = getToken();
  if (
    !token &&
    getRefreshToken() &&
    !options._skipRefresh &&
    !path.startsWith("/v1/auth/") &&
    path !== "/v1/csrf"
  ) {
    try {
      const refreshed = await refreshAuth({ _skipRetry: true });
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

  if (method !== "GET" && method !== "HEAD" && !options._skipCsrf) {
    const csrf = await ensureCsrf();
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let body;
  if (options.body != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const attemptFetch = async (retried) => {
    try {
      const res = await fetch(path, { method, headers, body });
      const payload = await parseJsonResponse(res);
      const requestId = extractRequestId(payload, res);

      if (res.status === 401 && !options._retried && getRefreshToken() && !path.startsWith("/v1/auth/")) {
        try {
          const refreshed = await refreshAuth({ _skipRetry: true });
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
        if (!options._skipRetry && shouldRetry({ method, idempotent }, res, retried)) {
          return attemptFetch(true);
        }
        const errorPayload = payload?.error || {};
        const message = errorPayload.message || `HTTP ${res.status}`;
        const err = new Error(message);
        err.code = errorPayload.code || "http_error";
        err.httpStatus = res.status;
        err.requestId = requestId;
        err.details = payload?.details || errorPayload.details || null;
        err.payload = payload;
        err.isApiError = true;
        throw err;
      }

      if (payload && requestId && !payload.requestId) {
        payload.requestId = requestId;
      }
      return payload;
    } catch (err) {
      if (err?.isApiError) throw err;
      if (!options._skipRetry && shouldRetry({ method, idempotent }, null, retried)) {
        return attemptFetch(true);
      }
      const wrapped = new Error(err?.message || "Network error");
      wrapped.code = "network_error";
      wrapped.httpStatus = 0;
      wrapped.requestId = null;
      wrapped.details = null;
      wrapped.isApiError = true;
      throw wrapped;
    }
  };

  return attemptFetch(false);
}

export function apiGet(path, options = {}) {
  return apiFetch(path, { method: "GET", headers: options.headers, _skipRetry: options._skipRetry });
}

export function apiPost(path, body, options = {}) {
  return apiFetch(path, {
    method: "POST",
    body,
    headers: options.headers,
    idempotent: options.idempotent,
    _skipRetry: options._skipRetry,
  });
}

export function apiPatch(path, body, options = {}) {
  return apiFetch(path, {
    method: "PATCH",
    body,
    headers: options.headers,
    idempotent: options.idempotent,
    _skipRetry: options._skipRetry,
  });
}

export function apiDelete(path, body, options = {}) {
  return apiFetch(path, {
    method: "DELETE",
    body,
    headers: options.headers,
    idempotent: options.idempotent,
    _skipRetry: options._skipRetry,
  });
}

export function requestAuth(email) {
  return apiPost("/v1/auth/request", { email }, { _skipRetry: true });
}

export function verifyAuth(email, code) {
  return apiPost("/v1/auth/verify", { email, code }, { _skipRetry: true });
}

export function refreshAuth(options = {}) {
  return apiPost("/v1/auth/refresh", { refreshToken: getRefreshToken() }, { _skipRefresh: true, ...options });
}

export function logoutAuth() {
  return apiPost("/v1/auth/logout", { refreshToken: getRefreshToken() }, { _skipRetry: true });
}
