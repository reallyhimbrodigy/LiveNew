import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'https://livenew.app';
const AUTH_KEY = 'livenew:auth';

let authToken = null;
let refreshToken = null;

// Callback registered by authStore. When the refresh-token flow fails, the
// store wires up a forced-logout handler so the user actually lands on
// AuthScreen instead of being stuck in a zombie session.
let onAuthExpired = null;
export function setAuthExpiredHandler(fn) {
  onAuthExpired = typeof fn === 'function' ? fn : null;
}

// Single-flight token refresh — prevents the storm where multiple in-flight
// 401s each trigger their own refresh call. The first request to need a
// refresh creates the promise; concurrent requests await the same result.
let refreshPromise = null;

export function setTokens(access, refresh) {
  authToken = access;
  refreshToken = refresh;
}

export function clearTokens() {
  authToken = null;
  refreshToken = null;
}

export function getAuthToken() {
  return authToken;
}

async function tryParseJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function persistTokens() {
  try {
    const authRaw = await AsyncStorage.getItem(AUTH_KEY);
    const existing = authRaw ? JSON.parse(authRaw) : {};
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify({
      ...existing,
      accessToken: authToken,
      refreshToken,
    }));
  } catch {}
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, opts);
  } catch (err) {
    // Network error (no internet, DNS failure, etc.)
    const netErr = new Error('Check your internet connection.');
    netErr.code = 'NETWORK_ERROR';
    throw netErr;
  }

  // Handle token refresh on 401 — single-flight so parallel 401s share work.
  if (res.status === 401 && refreshToken) {
    try {
      if (!refreshPromise) {
        refreshPromise = (async () => {
          const refreshRes = await fetch(`${BASE_URL}/v1/auth/refresh-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (!refreshRes.ok) throw new Error('REFRESH_FAILED');
          const refreshData = await tryParseJson(refreshRes);
          if (!refreshData?.accessToken) throw new Error('REFRESH_FAILED');
          authToken = refreshData.accessToken;
          if (refreshData.refreshToken) refreshToken = refreshData.refreshToken;
          await persistTokens();
          return authToken;
        })().finally(() => { refreshPromise = null; });
      }
      const newToken = await refreshPromise;
      // Retry original request with the freshly-minted token.
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const retryData = await tryParseJson(retryRes);
      if (!retryRes.ok) {
        const err = new Error(retryData?.message || retryData?.error?.message || 'Request failed');
        err.code = retryData?.code || retryData?.error?.code;
        err.status = retryRes.status;
        throw err;
      }
      return retryData;
    } catch (refreshErr) {
      if (refreshErr.code) throw refreshErr; // Re-throw if it's our error from retry
    }
    // Refresh failed — clear tokens AND tell the store to log the user out.
    // Without this, isLoggedIn stays true and the app sits in a zombie
    // session with every request failing.
    clearTokens();
    if (onAuthExpired) { try { onAuthExpired(); } catch {} }
    throw new Error('AUTH_EXPIRED');
  }

  const data = await tryParseJson(res);

  if (!res.ok) {
    const err = new Error(data?.message || data?.error?.message || `Request failed (${res.status})`);
    err.code = data?.code || data?.error?.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

export const api = {
  // Auth
  login: (email, password) => request('POST', '/v1/auth/login', { email, password }),
  signup: (email, password, name) => request('POST', '/v1/auth/signup', { email, password, name, consent: true }),
  verifySignupOtp: (email, code) => request('POST', '/v1/auth/verify-signup-otp', { email, code }),
  resendSignupOtp: (email) => request('POST', '/v1/auth/resend-signup-otp', { email }),
  resetPassword: (email) => request('POST', '/v1/auth/reset-password', { email }),
  logout: () => request('POST', '/v1/auth/logout', {}),

  // Bootstrap
  bootstrap: () => request('GET', '/v1/bootstrap'),

  // Check-in (generates day plan)
  checkin: (data) => request('POST', '/v1/checkin', { checkIn: data }),

  // Evening reflection
  reflect: (data) => request('POST', '/v1/reflect', data),

  // Feedback
  feedback: (data) => request('POST', '/v1/feedback', data),

  // Fresh AI stress relief — generated per-tap, never cached
  stressRelief: () => request('POST', '/v1/stress-relief', {}),

  // Free-form chat with Iris. `messages` is the rolling conversation
  // history (last 12 turns; server caps too). `healthSnapshot` optional.
  irisChat: (messages, healthSnapshot) => request('POST', '/v1/iris/chat', {
    messages,
    healthSnapshot: healthSnapshot || null,
  }),

  // Progress
  progress: () => request('GET', '/v1/progress'),

  // Consent
  acceptConsent: () => request('POST', '/v1/consents/accept', {
    consent: { terms: true, privacy: true, alpha_processing: true },
  }),

  // Profile
  onboardComplete: (profile) => request('POST', '/v1/onboard/complete', { profile }),

  // Account
  deleteAccount: () => request('POST', '/v1/account/delete', {}),
};
