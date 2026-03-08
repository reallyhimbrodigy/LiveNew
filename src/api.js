const BASE_URL = 'https://livenew.app';

let authToken = null;
let refreshToken = null;

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

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const opts = { method, headers, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();

  // Handle token refresh
  if (res.status === 401 && refreshToken) {
    const refreshRes = await fetch(`${BASE_URL}/v1/auth/refresh-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      if (refreshData.accessToken) {
        authToken = refreshData.accessToken;
        if (refreshData.refreshToken) refreshToken = refreshData.refreshToken;
        // Retry original request
        headers['Authorization'] = `Bearer ${authToken}`;
        const retryRes = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return retryRes.json();
      }
    }
    // Refresh failed — clear tokens
    clearTokens();
    throw new Error('AUTH_EXPIRED');
  }

  if (!res.ok) {
    const err = new Error(data.message || data.error?.message || 'Request failed');
    err.code = data.code || data.error?.code;
    err.status = res.status;
    throw err;
  }

  return data;
}

export const api = {
  // Auth
  login: (email, password) => request('POST', '/v1/auth/login', { email, password }),
  signup: (email, password, name) => request('POST', '/v1/auth/signup', { email, password, name, consent: true }),
  logout: () => request('POST', '/v1/auth/logout', {}),

  // Bootstrap
  bootstrap: () => request('GET', '/v1/bootstrap'),

  // Check-in (generates day plan)
  checkin: (data) => request('POST', '/v1/checkin', { checkIn: data }),

  // Completions
  completeMove: (dateISO) => request('POST', '/v1/move/complete', { dateISO }),
  completeReset: (dateISO) => request('POST', '/v1/reset/complete', { dateISO }),
  completeWinddown: (dateISO) => request('POST', '/v1/winddown/complete', { dateISO }),

  // Feedback
  feedback: (data) => request('POST', '/v1/feedback', data),

  // Progress
  progress: () => request('GET', '/v1/progress'),

  // Profile
  onboardComplete: (profile) => request('POST', '/v1/onboard/complete', { profile }),
  updateProfile: (profile) => request('POST', '/v1/profile/update', { profile }),

  // Account
  deleteAccount: () => request('POST', '/v1/account/delete', {}),
};
