import { spawn } from "child_process";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import fs from "fs/promises";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const PORT = String(3900 + Math.floor(Math.random() * 500));
const DATA_DIR = path.join(ROOT, "data", `test-int-${Date.now()}`);
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

function assertErrorPayload(payload, label) {
  assert(payload && payload.ok === false, `${label} should return ok:false`);
  assert(payload.error && typeof payload.error.code === "string", `${label} should include error.code`);
  assert(payload.error && typeof payload.error.message === "string", `${label} should include error.message`);
  assert(payload.error && typeof payload.error.requestId === "string", `${label} should include error.requestId`);
}

function assertErrorCode(payload, expected, label) {
  assert(payload && payload.error === expected, `${label} should return error:${expected}`);
}

async function waitForReady() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const { res, payload } = await fetchJson("/readyz");
      if (res.ok && payload?.ok) return;
    } catch {
      // ignore
    }
    await delay(200);
  }
  throw new Error("Server not ready");
}

function contractKey(contract) {
  return JSON.stringify({
    reset: contract?.reset?.id || null,
    movement: contract?.movement?.id || null,
    nutrition: contract?.nutrition?.id || null,
    hash: contract?.meta?.inputHash || null,
  });
}

async function run() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const env = {
    ...process.env,
    ENV_MODE: "dev",
    TEST_MODE: "true",
    PORT,
    DATA_DIR,
    DB_PATH: path.join(DATA_DIR, "livenew.sqlite"),
    AUTH_REQUIRED: "true",
    ADMIN_EMAILS: "admin@example.com",
    ADMIN_IN_DEV: "true",
  };
  const server = spawn("node", ["src/server/index.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForReady();

    const bootstrapUnauth = await fetchJson("/v1/bootstrap");
    assert(bootstrapUnauth.payload?.uiState === "login", "bootstrap without auth should be login");

    const requestRes = await fetchJson("/v1/auth/request", {
      method: "POST",
      body: { email: "test@example.com" },
    });
    assert(requestRes.payload?.code, "auth/request should return code in dev");

    const verifyRes = await fetchJson("/v1/auth/verify", {
      method: "POST",
      body: { email: "test@example.com", code: requestRes.payload.code },
    });
    assert(verifyRes.payload?.accessToken, "auth/verify should return accessToken");
    const authHeaders = { Authorization: `Bearer ${verifyRes.payload.accessToken}` };

    const bootstrapPreConsent = await fetchJson("/v1/bootstrap", { headers: authHeaders });
    assert(bootstrapPreConsent.payload?.uiState === "consent", "bootstrap should be consent before consent");

    const railPreConsent = await fetchJson("/v1/rail/today", { headers: authHeaders });
    assert(railPreConsent.res.status >= 403, "rail/today should be blocked before consent");
    assertErrorPayload(railPreConsent.payload, "rail/today pre-consent");

    const consentRes = await fetchJson("/v1/consent/accept", {
      method: "POST",
      headers: authHeaders,
      body: { accept: { terms: true, privacy: true, alphaProcessing: true } },
    });
    assert(consentRes.payload?.ok, "consent/accept should return ok");

    const bootstrapOnboard = await fetchJson("/v1/bootstrap", { headers: authHeaders });
    assert(bootstrapOnboard.payload?.uiState === "onboard", "bootstrap should be onboard when baseline missing");

    const railPreOnboard = await fetchJson("/v1/rail/today", { headers: authHeaders });
    assert(railPreOnboard.res.status >= 403, "rail/today should be blocked before onboard");
    assertErrorCode(railPreOnboard.payload, "BOOTSTRAP_NOT_HOME", "rail/today pre-onboard");

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

    const bootstrapHome = await fetchJson("/v1/bootstrap", { headers: authHeaders });
    assert(bootstrapHome.payload?.uiState === "home", "bootstrap should be home after onboard");

    const today1 = await fetchJson("/v1/rail/today", { headers: authHeaders });
    assert(today1.payload?.ok, "rail/today should return ok");
    assert(today1.payload?.reset?.durationSec >= 120, "reset durationSec should be >= 120");
    const key1 = contractKey(today1.payload);

    const today1b = await fetchJson("/v1/rail/today", { headers: authHeaders });
    assert(contractKey(today1b.payload) === key1, "rail/today should be deterministic");

    const resetId = today1.payload.reset.id;
    const dateKey = today1.payload.dateKey || today1.payload.dateISO;
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

    const db = new DatabaseSync(path.join(DATA_DIR, "livenew.sqlite"));
    const resetCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM daily_events WHERE date_iso = ? AND type = 'reset_completed'")
      .get(dateKey);
    const resetCount = resetCountRow?.count ?? 0;
    assert(resetCount === 1, "reset_completed should be written once per day");
    db.close();

    const checkIn = { stress: 8, sleepQuality: 4, energy: 3, timeAvailableMin: 10 };
    const today2 = await fetchJson("/v1/checkin", {
      method: "POST",
      headers: authHeaders,
      body: { checkIn, dateKey },
    });
    assert(today2.payload?.ok, "checkin should return ok");
    assert(today2.payload?.meta?.inputHash, "checkin should return inputHash");

    const today2b = await fetchJson("/v1/checkin", {
      method: "POST",
      headers: authHeaders,
      body: { checkIn, dateKey },
    });
    assert(today2b.payload?.meta?.inputHash === today2.payload?.meta?.inputHash, "checkin should be deterministic");

    const invalidCheckIn = await fetchJson("/v1/checkin", {
      method: "POST",
      headers: authHeaders,
      body: { checkIn: { stress: "bad" }, dateKey },
    });
    assert(invalidCheckIn.res.status === 400, "invalid checkin should return 400");
    assertErrorCode(invalidCheckIn.payload, "INVALID_CHECKIN", "invalid checkin");

    const quickRes = await fetchJson("/v1/quick", {
      method: "POST",
      headers: authHeaders,
      body: { signal: "ten_minutes", dateKey },
    });
    assert(quickRes.payload?.ok, "quick adjust should return ok");
    assert(quickRes.payload?.movement == null, "ten_minutes should suppress movement");

    const outcomes = await fetchJson("/v1/outcomes?days=7", { headers: authHeaders });
    assert(outcomes.payload?.ok, "outcomes should return ok");
    assert(Number.isFinite(outcomes.payload?.metrics?.railOpenedDays), "outcomes should include railOpenedDays");
    assert(outcomes.payload.metrics.resetCompletedDays >= 1, "outcomes should count reset completion");
    assert(outcomes.payload.metrics.checkinSubmittedDays >= 1, "outcomes should count checkin submissions");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
