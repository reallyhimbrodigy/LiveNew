import assert from "node:assert";

const BASE_URL = process.env.BASE_URL || process.env.SIM_BASE_URL || "http://127.0.0.1:3000";
const AUTH_TOKEN = process.env.AUTH_TOKEN || process.env.SIM_AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const EMAIL = process.env.SMOKE_EMAIL || process.env.SIM_EMAIL || "kill-switch@example.com";
const STEP = (process.env.VERIFY_STEP || "baseline").toLowerCase();

function assertOk(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchJson(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "x-client-type": "ops",
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
  return { res, payload, headers: res.headers };
}

function bearer(token) {
  if (!token) return "";
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function ensureAuth() {
  if (AUTH_TOKEN) return AUTH_TOKEN;
  const requestRes = await fetchJson("/v1/auth/request", { method: "POST", body: { email: EMAIL } });
  assertOk(requestRes.payload?.code, "auth/request should return code in dev");
  const verifyRes = await fetchJson("/v1/auth/verify", {
    method: "POST",
    body: { email: EMAIL, code: requestRes.payload.code },
  });
  assertOk(verifyRes.payload?.accessToken, "auth/verify should return accessToken");
  return verifyRes.payload.accessToken;
}

async function ensureBootstrapAndOnboard(authHeaders) {
  const bootstrap = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  if (bootstrap.payload?.uiState === "login") {
    const token = await ensureAuth();
    authHeaders.Authorization = bearer(token);
  }

  const bootstrapAuth = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  if (bootstrapAuth.payload?.uiState === "consent") {
    const consentRes = await fetchJson("/v1/consent/accept", {
      method: "POST",
      headers: authHeaders,
      body: { accept: { terms: true, privacy: true, alphaProcessing: true } },
    });
    assertOk(consentRes.payload?.ok, "consent/accept should return ok");
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
    assertOk(onboardRes.payload?.ok, "onboard/complete should return ok");
  }

  const bootstrapHome = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  assertOk(bootstrapHome.payload?.uiState === "home", "bootstrap should be home");
  return bootstrapHome.payload;
}

async function getToday(authHeaders) {
  const today = await fetchJson("/v1/rail/today", { headers: authHeaders });
  assertOk(today.payload?.ok, "rail/today should return ok");
  return today.payload;
}

async function assertStableToday(authHeaders) {
  const first = await getToday(authHeaders);
  const second = await getToday(authHeaders);
  assertOk(first.meta?.inputHash === second.meta?.inputHash, "today inputHash should be stable");
  return first;
}

async function fetchOutcomes(authHeaders) {
  const outcomes = await fetchJson("/v1/outcomes?days=7", { headers: authHeaders });
  assertOk(outcomes.payload?.ok, "outcomes should return ok");
  return outcomes.payload;
}

async function baselineStep(authHeaders) {
  const today = await assertStableToday(authHeaders);
  const dateKey = today.dateKey || today.dateISO;
  const resetId = today.reset?.id;

  const checkin = await fetchJson("/v1/checkin", {
    method: "POST",
    headers: authHeaders,
    body: { checkIn: { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10 }, dateKey },
  });
  assertOk(checkin.payload?.ok, "checkin should return ok in baseline");

  const quick = await fetchJson("/v1/quick", {
    method: "POST",
    headers: authHeaders,
    body: { signal: "stressed", dateKey },
  });
  assertOk(quick.payload?.ok, "quick should return ok in baseline");

  const reset = await fetchJson("/v1/reset/complete", {
    method: "POST",
    headers: authHeaders,
    body: { resetId, dateKey },
  });
  assertOk(reset.payload?.meta?.completed?.reset === true, "reset should complete in baseline");
}

async function checkToggle(authHeaders, { route, body, expectedError, label }) {
  const before = await fetchOutcomes(authHeaders);
  const todayBefore = await assertStableToday(authHeaders);
  const res = await fetchJson(route, { method: "POST", headers: authHeaders, body });
  assertOk(res.res.status === 503, `${label} should return 503 when disabled`);
  assertOk(res.payload?.error === expectedError, `${label} should return ${expectedError}`);
  const after = await fetchOutcomes(authHeaders);
  const todayAfter = await assertStableToday(authHeaders);
  assert.deepStrictEqual(before.metrics, after.metrics, `${label} should not change outcomes metrics`);
  assertOk(todayBefore.meta?.inputHash === todayAfter.meta?.inputHash, `${label} should not change today inputHash`);
}

function printNextSteps() {
  console.log(
    JSON.stringify(
      {
        ok: true,
        instructions: [
          "Baseline: ensure all DISABLE_* toggles are false; run VERIFY_STEP=baseline",
          "Checkin: set DISABLE_CHECKIN_WRITES=true, restart, run VERIFY_STEP=checkin",
          "Quick: set DISABLE_QUICK_WRITES=true, restart, run VERIFY_STEP=quick",
          "Reset: set DISABLE_RESET_WRITES=true, restart, run VERIFY_STEP=reset",
        ],
      },
      null,
      2
    )
  );
}

async function main() {
  const authHeaders = {};
  await ensureBootstrapAndOnboard(authHeaders);

  if (STEP === "baseline") {
    await baselineStep(authHeaders);
    printNextSteps();
    return;
  }

  const today = await getToday(authHeaders);
  const dateKey = today.dateKey || today.dateISO;
  const resetId = today.reset?.id;

  if (STEP === "checkin") {
    await checkToggle(authHeaders, {
      route: "/v1/checkin",
      body: { checkIn: { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10 }, dateKey },
      expectedError: "CHECKIN_DISABLED",
      label: "checkin",
    });
    printNextSteps();
    return;
  }

  if (STEP === "quick") {
    await checkToggle(authHeaders, {
      route: "/v1/quick",
      body: { signal: "stressed", dateKey },
      expectedError: "QUICK_DISABLED",
      label: "quick",
    });
    printNextSteps();
    return;
  }

  if (STEP === "reset") {
    await checkToggle(authHeaders, {
      route: "/v1/reset/complete",
      body: { resetId, dateKey },
      expectedError: "RESET_DISABLED",
      label: "reset",
    });
    printNextSteps();
    return;
  }

  throw new Error(`Unknown VERIFY_STEP: ${STEP}`);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, step: STEP, error: err?.message || String(err) }));
  process.exit(1);
});
