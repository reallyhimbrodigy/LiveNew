// Runbook: set SIM_BASE_URL and SIM_AUTH_TOKEN for remote runs. Optional: SIM_DAYS, SIM_CONCURRENCY.
import fs from "fs/promises";
import path from "path";
import assert from "node:assert";

const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "http://127.0.0.1:3000";
const AUTH_TOKEN = process.env.SIM_AUTH_TOKEN || process.env.AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const EMAIL = process.env.SIM_EMAIL || process.env.SMOKE_EMAIL || "simulate@example.com";
const SCENARIO_INPUT = process.env.SIM_SCENARIO || "";
const DAYS = Math.max(1, Number(process.env.SIM_DAYS || 3));
const CONCURRENCY = process.env.SIM_CONCURRENCY === "true" || process.env.SIM_CONCURRENCY === "1";
const NONDET_CHECKS = Math.max(1, Number(process.env.SIM_NONDET_CHECKS || 3));
const DB_PATH = process.env.SIM_DB_PATH || process.env.DB_PATH || "";
const stats = {
  rateLimited: 0,
  gatingViolations: 0,
  responses: 0,
};

function assertOk(cond, message) {
  if (!cond) throw new Error(message);
}

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bearer(token) {
  if (!token) return "";
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function fetchJson(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "x-client-type": "simulate",
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
  stats.responses += 1;
  if (res.status === 429) stats.rateLimited += 1;
  if (
    res.status === 403 &&
    (payload?.error === "CANARY_GATED" || payload?.error === "BOOTSTRAP_NOT_HOME")
  ) {
    stats.gatingViolations += 1;
  }
  return { res, payload, headers: res.headers };
}

async function ensureAuth() {
  if (AUTH_TOKEN) return AUTH_TOKEN;
  const requestRes = await fetchJson("/v1/auth/request", {
    method: "POST",
    body: { email: EMAIL },
  });
  assertOk(requestRes.payload?.code, "auth/request should return code in dev");
  const verifyRes = await fetchJson("/v1/auth/verify", {
    method: "POST",
    body: { email: EMAIL, code: requestRes.payload.code },
  });
  assertOk(verifyRes.payload?.accessToken, "auth/verify should return accessToken");
  return verifyRes.payload.accessToken;
}

async function loadScenario() {
  if (!SCENARIO_INPUT) return null;
  const root = process.cwd();
  const candidatePaths = [];
  if (SCENARIO_INPUT.endsWith(".json")) {
    candidatePaths.push(path.isAbsolute(SCENARIO_INPUT) ? SCENARIO_INPUT : path.join(root, SCENARIO_INPUT));
  } else {
    candidatePaths.push(path.join(root, "scripts", "scenarios", `${SCENARIO_INPUT}.json`));
    candidatePaths.push(path.join(root, "scripts", "scenarios", SCENARIO_INPUT));
  }
  for (const filePath of candidatePaths) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      // try next
    }
  }
  throw new Error(`Scenario not found: ${SCENARIO_INPUT}`);
}

function resolveBusyDays(value, todayISO) {
  if (!Array.isArray(value)) return value;
  return value
    .map((entry) => {
      if (typeof entry !== "string") return null;
      if (entry === "__TODAY__") return todayISO;
      const match = entry.match(/^__TODAY__\+(\d+)$/);
      if (match) return addDaysISO(todayISO, Number(match[1]));
      return entry;
    })
    .filter(Boolean);
}

async function ensureBootstrapAndOnboard(authHeaders, scenario) {
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
    const baseline = scenario?.baseline || {
      timezone: "America/Los_Angeles",
      dayBoundaryHour: 4,
      constraints: { equipment: { none: true } },
    };
    const firstCheckIn = scenario?.checkIn || {
      stress: 4,
      sleepQuality: 7,
      energy: 6,
      timeAvailableMin: 20,
    };
    const onboardRes = await fetchJson("/v1/onboard/complete", {
      method: "POST",
      headers: authHeaders,
      body: {
        consent: { terms: true, privacy: true, alphaProcessing: true },
        baseline,
        firstCheckIn,
      },
    });
    assertOk(onboardRes.payload?.ok, "onboard/complete should return ok");
  }

  const bootstrapHome = await fetchJson("/v1/bootstrap", { headers: authHeaders });
  if (bootstrapHome.payload?.uiState !== "home") {
    stats.gatingViolations += 1;
  }
  assertOk(bootstrapHome.payload?.uiState === "home", "bootstrap should be home");
  return bootstrapHome.payload;
}

async function applyScenarioProfile(authHeaders, scenario, todayISO) {
  if (!scenario) return;
  const baseline = scenario.baseline || {};
  const profile = scenario.profile && typeof scenario.profile === "object" ? { ...scenario.profile } : {};
  if (profile.busyDays) {
    profile.busyDays = resolveBusyDays(profile.busyDays, todayISO);
  }
  if (baseline.timezone) profile.timezone = baseline.timezone;
  if (baseline.dayBoundaryHour != null) profile.dayBoundaryHour = baseline.dayBoundaryHour;
  if (baseline.constraints) profile.constraints = baseline.constraints;
  if (!Object.keys(profile).length) return;
  const res = await fetchJson("/v1/profile", {
    method: "POST",
    headers: authHeaders,
    body: { userProfile: profile },
  });
  assertOk(res.payload?.ok, "profile update should return ok");
}

async function maybeOpenDb() {
  if (!DB_PATH) return null;
  try {
    await fs.stat(DB_PATH);
  } catch {
    return null;
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(DB_PATH);
  } catch {
    return null;
  }
}

function idempotencyHeaders(key) {
  return key ? { "Idempotency-Key": key } : {};
}

async function ensureIdempotentResult(promiseResults, retryFn) {
  const ok = promiseResults.find((entry) => entry?.payload?.ok);
  if (ok) return ok;
  const retry = await retryFn();
  return retry;
}

async function main() {
  const scenario = await loadScenario();
  const authHeaders = {};
  const bootstrap = await ensureBootstrapAndOnboard(authHeaders, scenario);
  const todayISO = bootstrap?.now?.dateISO || new Date().toISOString().slice(0, 10);
  await applyScenarioProfile(authHeaders, scenario, todayISO);

  const db = await maybeOpenDb();
  let nondeterminism = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const todayRes = await fetchJson("/v1/rail/today", { headers: authHeaders });
    assertOk(todayRes.payload?.ok, "rail/today should return ok");
    const dateKey = todayRes.payload?.dateKey || todayRes.payload?.dateISO;
    const resetId = todayRes.payload?.reset?.id;
    assertOk(dateKey && resetId, "rail/today should include dateKey and resetId");
    const inputHash = todayRes.payload?.meta?.inputHash || null;

    for (let i = 0; i < NONDET_CHECKS; i += 1) {
      const repeat = await fetchJson("/v1/rail/today", { headers: authHeaders });
      const hash = repeat.payload?.meta?.inputHash || null;
      if (inputHash && hash && hash !== inputHash) nondeterminism += 1;
    }

    if (CONCURRENCY) {
      await Promise.all([
        fetchJson("/v1/reset/complete", {
          method: "POST",
          headers: authHeaders,
          body: { resetId, dateKey },
        }),
        fetchJson("/v1/reset/complete", {
          method: "POST",
          headers: authHeaders,
          body: { resetId, dateKey },
        }),
      ]);
    } else {
      const complete = await fetchJson("/v1/reset/complete", {
        method: "POST",
        headers: authHeaders,
        body: { resetId, dateKey },
      });
      assertOk(complete.payload?.meta?.completed?.reset === true, "reset complete should reflect in contract");
    }

    const checkIn = scenario?.checkIn || { stress: 6, sleepQuality: 6, energy: 6, timeAvailableMin: 20 };
    const checkinKey = `sim-checkin-${dateKey}`;
    if (CONCURRENCY) {
      const results = await Promise.all([
        fetchJson("/v1/checkin", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(checkinKey) },
          body: { checkIn, dateKey },
        }),
        fetchJson("/v1/checkin", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(checkinKey) },
          body: { checkIn, dateKey },
        }),
      ]);
      const resolved = await ensureIdempotentResult(results, () =>
        fetchJson("/v1/checkin", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(checkinKey) },
          body: { checkIn, dateKey },
        })
      );
      assertOk(resolved.payload?.ok, "idempotent checkin should return ok");
    } else {
      const res = await fetchJson("/v1/checkin", {
        method: "POST",
        headers: authHeaders,
        body: { checkIn, dateKey },
      });
      assertOk(res.payload?.ok, "checkin should return ok");
    }

    const quickSignal = "ten_minutes";
    const quickKey = `sim-quick-${dateKey}`;
    if (CONCURRENCY) {
      const results = await Promise.all([
        fetchJson("/v1/quick", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(quickKey) },
          body: { signal: quickSignal, dateKey },
        }),
        fetchJson("/v1/quick", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(quickKey) },
          body: { signal: quickSignal, dateKey },
        }),
      ]);
      const resolved = await ensureIdempotentResult(results, () =>
        fetchJson("/v1/quick", {
          method: "POST",
          headers: { ...authHeaders, ...idempotencyHeaders(quickKey) },
          body: { signal: quickSignal, dateKey },
        })
      );
      assertOk(resolved.payload?.ok, "idempotent quick should return ok");
    } else {
      const res = await fetchJson("/v1/quick", {
        method: "POST",
        headers: authHeaders,
        body: { signal: quickSignal, dateKey },
      });
      assertOk(res.payload?.ok, "quick should return ok");
    }

    if (db) {
      const resetCount = db
        .prepare("SELECT COUNT(*) AS count FROM daily_events WHERE date_iso = ? AND type = 'reset_completed'")
        .get(dateKey)?.count;
      const checkinCount = db
        .prepare("SELECT COUNT(*) AS count FROM daily_events WHERE date_iso = ? AND type = 'checkin_submitted'")
        .get(dateKey)?.count;
      const quickCount = db
        .prepare("SELECT COUNT(*) AS count FROM daily_events WHERE date_iso = ? AND type = 'quick_adjusted'")
        .get(dateKey)?.count;
      assertOk((resetCount ?? 0) <= 1, "reset_completed should be written once per day");
      assertOk((checkinCount ?? 0) <= 1, "checkin_submitted should be written once per day");
      assertOk((quickCount ?? 0) <= 1, "quick_adjusted should be written once per day");
    }
  }

  if (db && typeof db.close === "function") db.close();
  assertOk(nondeterminism === 0, `nondeterminism detected (${nondeterminism})`);

  const outcomes = await fetchJson(`/v1/outcomes?days=${Math.min(7, DAYS + 3)}`, { headers: authHeaders });
  assertOk(outcomes.payload?.ok, "outcomes should return ok");

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      days: DAYS,
      concurrency: CONCURRENCY,
      nondeterminism,
      scenario: scenario?.id || null,
      stats,
    })
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err?.message || String(err),
      baseUrl: BASE_URL,
      scenario: SCENARIO_INPUT || null,
      stats,
    })
  );
  process.exit(1);
});
