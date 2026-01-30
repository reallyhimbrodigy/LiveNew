import { getDateKey } from "../src/utils/dateKey.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.SMOKE_EMAIL || "smoke@example.com";
const TOKEN = process.env.SMOKE_TOKEN || null;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchJson(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "x-client-type": "api",
    ...(options.headers || {}),
  };
  const body = options.body != null ? JSON.stringify(options.body) : undefined;
  const res = await fetch(`${BASE_URL}${pathname}`, { method: options.method || "GET", headers, body });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { res, payload };
}

async function ensureAuth() {
  if (TOKEN) return TOKEN;
  const requestRes = await fetchJson("/v1/auth/request", {
    method: "POST",
    body: { email: EMAIL },
  });
  assert(requestRes.payload?.code, "auth/request should return code in dev");
  const verifyRes = await fetchJson("/v1/auth/verify", {
    method: "POST",
    body: { email: EMAIL, code: requestRes.payload.code },
  });
  assert(verifyRes.payload?.accessToken, "auth/verify should return accessToken");
  return verifyRes.payload.accessToken;
}

async function main() {
  const bootstrap = await fetchJson("/v1/bootstrap");
  let token = null;
  if (bootstrap.payload?.uiState === "login") {
    token = await ensureAuth();
  } else if (TOKEN) {
    token = TOKEN;
  }
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const bootstrapAuth = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  if (bootstrapAuth.payload?.uiState === "consent") {
    const consentRes = await fetchJson("/v1/consent/accept", {
      method: "POST",
      headers: authHeaders,
      body: { accept: { terms: true, privacy: true, alphaProcessing: true } },
    });
    assert(consentRes.payload?.ok, "consent/accept should return ok");
  }

  const bootstrapAfterConsent = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  if (bootstrapAfterConsent.payload?.uiState === "onboard") {
    const baseline = {
      timezone: "America/Los_Angeles",
      dayBoundaryHour: 4,
      constraints: { equipment: { none: true } },
    };
    const firstCheckIn = { stress: 4, sleepQuality: 7, energy: 6, timeAvailableMin: 20 };
    const onboardRes = await fetchJson("/v1/onboard/complete", {
      method: "POST",
      headers: authHeaders,
      body: { consent: { terms: true, privacy: true, alphaProcessing: true }, baseline, firstCheckIn },
    });
    assert(onboardRes.payload?.ok, "onboard/complete should return ok");
  }

  const timezone = "America/Los_Angeles";
  const boundaryKeyBefore = getDateKey({ now: "2026-01-30T10:59:00Z", timezone, dayBoundaryHour: 4 });
  const boundaryKeyAfter = getDateKey({ now: "2026-01-30T13:30:00Z", timezone, dayBoundaryHour: 4 });
  assert(boundaryKeyBefore < boundaryKeyAfter, "dateKey boundary rollover should work");

  const todayRes = await fetchJson("/v1/rail/today", { headers: authHeaders });
  assert(todayRes.res.status === 200, "rail/today should return 200");
  assert(todayRes.payload?.meta?.inputHash, "rail/today should return inputHash");
  const dateKey = todayRes.payload?.dateKey || todayRes.payload?.dateISO;
  const resetId = todayRes.payload?.reset?.id;
  assert(dateKey && resetId, "rail/today should include dateKey and resetId");

  const etag = todayRes.payload?.meta?.inputHash;
  const cached = await fetchJson("/v1/rail/today", { headers: { ...authHeaders, "If-None-Match": etag } });
  assert(cached.res.status === 304, "ETag should return 304 when unchanged");

  const complete1 = await fetchJson("/v1/reset/complete", {
    method: "POST",
    headers: authHeaders,
    body: { resetId, dateKey },
  });
  assert(complete1.payload?.meta?.completed?.reset === true, "reset complete should reflect in contract");

  const complete2 = await fetchJson("/v1/reset/complete", {
    method: "POST",
    headers: authHeaders,
    body: { resetId, dateKey },
  });
  assert(complete2.payload?.meta?.completed?.reset === true, "reset complete should be idempotent");

  const checkIn = { stress: 7, sleepQuality: 5, energy: 4, timeAvailableMin: 12 };
  const checkRes = await fetchJson("/v1/checkin", {
    method: "POST",
    headers: authHeaders,
    body: { checkIn, dateKey },
  });
  assert(checkRes.payload?.ok, "checkin should return ok");

  const idemKey = "smoke-idem-checkin";
  const retry1 = await fetchJson("/v1/checkin", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": idemKey },
    body: { checkIn, dateKey },
  });
  const retry2 = await fetchJson("/v1/checkin", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": idemKey },
    body: { checkIn, dateKey },
  });
  assert(retry1.payload?.ok && retry2.payload?.ok, "idempotent checkin should return ok");
  assert(retry1.payload?.meta?.inputHash === retry2.payload?.meta?.inputHash, "idempotent checkin should be stable");

  const signals = ["stressed", "exhausted", "ten_minutes", "more_energy"];
  for (const signal of signals) {
    const quickRes = await fetchJson("/v1/quick", {
      method: "POST",
      headers: authHeaders,
      body: { signal, dateKey },
    });
    assert(quickRes.payload?.ok, `quick ${signal} should return ok`);
  }

  const quickIdemKey = "smoke-idem-quick";
  const quickRetry1 = await fetchJson("/v1/quick", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": quickIdemKey },
    body: { signal: "stressed", dateKey },
  });
  const quickRetry2 = await fetchJson("/v1/quick", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": quickIdemKey },
    body: { signal: "stressed", dateKey },
  });
  assert(quickRetry1.payload?.ok && quickRetry2.payload?.ok, "idempotent quick should return ok");
  assert(quickRetry1.payload?.meta?.inputHash === quickRetry2.payload?.meta?.inputHash, "idempotent quick stable");

  const outcomes = await fetchJson("/v1/outcomes?days=7", { headers: authHeaders });
  assert(outcomes.payload?.ok, "outcomes should return ok");
  assert(outcomes.payload?.metrics?.railOpenedDays >= 0, "outcomes metrics should be non-negative");
  assert(outcomes.payload?.metrics?.resetCompletionRate >= 0, "resetCompletionRate should be non-negative");

  console.log(JSON.stringify({ ok: true }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
