import { spawn } from "child_process";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import fs from "fs/promises";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

const ROOT = process.cwd();

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "x-client-type": "api",
    ...(options.headers || {}),
  };
  const body = options.body != null ? JSON.stringify(options.body) : undefined;
  const res = await fetch(`${baseUrl}${pathname}`, { method: options.method || "GET", headers, body });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { res, payload };
}

async function waitForReady(baseUrl) {
  for (let i = 0; i < 30; i += 1) {
    try {
      const { res, payload } = await fetchJson(baseUrl, "/readyz");
      if (res.ok && payload?.ok) return;
    } catch {
      // ignore
    }
    await delay(200);
  }
  throw new Error("Server not ready");
}

async function withServer(envOverrides, fn) {
  const PORT = String(4100 + Math.floor(Math.random() * 500));
  const DATA_DIR = path.join(ROOT, "data", `test-safeguard-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
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
    ...envOverrides,
  };
  const server = spawn("node", ["src/server/index.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const baseUrl = `http://127.0.0.1:${PORT}`;
  try {
    await waitForReady(baseUrl);
    await fn(baseUrl);
  } finally {
    server.kill("SIGTERM");
  }
}

async function authHeaders(baseUrl, email) {
  const requestRes = await fetchJson(baseUrl, "/v1/auth/request", {
    method: "POST",
    body: { email },
  });
  assert(requestRes.payload?.code, "auth/request should return code in dev");
  const verifyRes = await fetchJson(baseUrl, "/v1/auth/verify", {
    method: "POST",
    body: { email, code: requestRes.payload.code },
  });
  assert(verifyRes.payload?.accessToken, "auth/verify should return accessToken");
  return { Authorization: `Bearer ${verifyRes.payload.accessToken}` };
}

async function onboard(baseUrl, headers) {
  const consentRes = await fetchJson(baseUrl, "/v1/consent/accept", {
    method: "POST",
    headers,
    body: { accept: { terms: true, privacy: true, alphaProcessing: true } },
  });
  assert(consentRes.payload?.ok, "consent/accept should return ok");
  const baseline = {
    timezone: "America/Los_Angeles",
    dayBoundaryHour: 4,
    constraints: { equipment: { none: true } },
  };
  const firstCheckIn = { stress: 4, sleepQuality: 7, energy: 6, timeAvailableMin: 20 };
  const onboardRes = await fetchJson(baseUrl, "/v1/onboard/complete", {
    method: "POST",
    headers,
    body: { consent: { terms: true, privacy: true, alphaProcessing: true }, baseline, firstCheckIn },
  });
  assert(onboardRes.payload?.ok, "onboard/complete should return ok");
}

async function testCanaryGating() {
  await withServer({ CANARY_ALLOWLIST: "allow@example.com" }, async (baseUrl) => {
    const headers = await authHeaders(baseUrl, "blocked@example.com");
    await onboard(baseUrl, headers);
    const bootstrap = await fetchJson(baseUrl, "/v1/bootstrap", { headers });
    assert(bootstrap.payload?.uiState !== "home", "canary should block home uiState");

    const plan = await fetchJson(baseUrl, "/v1/plan/day?date=2026-01-30", { headers });
    assert(plan.res.status === 403, "plan/day should be gated by canary");
    assert(plan.payload?.error === "CANARY_GATED", "plan/day should return CANARY_GATED");
  });
}

async function testWritesDisabled() {
  await withServer({ WRITES_DISABLED: "true", CANARY_ALLOWLIST: "writer@example.com" }, async (baseUrl) => {
    const headers = await authHeaders(baseUrl, "writer@example.com");
    await onboard(baseUrl, headers);

    const today = await fetchJson(baseUrl, "/v1/rail/today", { headers });
    assert(today.payload?.ok, "rail/today should still return ok when writes disabled");
    const dateKey = today.payload?.dateKey || today.payload?.dateISO;
    const resetId = today.payload?.reset?.id;

    const checkin = await fetchJson(baseUrl, "/v1/checkin", {
      method: "POST",
      headers,
      body: { checkIn: { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10 }, dateKey },
    });
    assert(checkin.res.status === 503, "checkin should return 503 when writes disabled");
    assert(checkin.payload?.error === "WRITES_DISABLED", "checkin should return WRITES_DISABLED");

    const quick = await fetchJson(baseUrl, "/v1/quick", {
      method: "POST",
      headers,
      body: { signal: "stressed", dateKey },
    });
    assert(quick.res.status === 503, "quick should return 503 when writes disabled");
    assert(quick.payload?.error === "WRITES_DISABLED", "quick should return WRITES_DISABLED");

    const complete = await fetchJson(baseUrl, "/v1/reset/complete", {
      method: "POST",
      headers,
      body: { resetId, dateKey },
    });
    assert(complete.res.status === 503, "reset/complete should return 503 when writes disabled");
    assert(complete.payload?.error === "WRITES_DISABLED", "reset/complete should return WRITES_DISABLED");
  });
}

async function testGranularKillSwitches() {
  await withServer({ DISABLE_CHECKIN_WRITES: "true", CANARY_ALLOWLIST: "checkin@example.com" }, async (baseUrl) => {
    const headers = await authHeaders(baseUrl, "checkin@example.com");
    await onboard(baseUrl, headers);
    const today = await fetchJson(baseUrl, "/v1/rail/today", { headers });
    assert(today.payload?.ok, "rail/today should return ok when checkin disabled");
    const dateKey = today.payload?.dateKey || today.payload?.dateISO;

    const checkin = await fetchJson(baseUrl, "/v1/checkin", {
      method: "POST",
      headers,
      body: { checkIn: { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10 }, dateKey },
    });
    assert(checkin.res.status === 503, "checkin should return 503 when disabled");
    assert(checkin.payload?.error === "CHECKIN_DISABLED", "checkin should return CHECKIN_DISABLED");
  });

  await withServer({ DISABLE_QUICK_WRITES: "true", CANARY_ALLOWLIST: "quick@example.com" }, async (baseUrl) => {
    const headers = await authHeaders(baseUrl, "quick@example.com");
    await onboard(baseUrl, headers);
    const today = await fetchJson(baseUrl, "/v1/rail/today", { headers });
    assert(today.payload?.ok, "rail/today should return ok when quick disabled");
    const dateKey = today.payload?.dateKey || today.payload?.dateISO;

    const quick = await fetchJson(baseUrl, "/v1/quick", {
      method: "POST",
      headers,
      body: { signal: "stressed", dateKey },
    });
    assert(quick.res.status === 503, "quick should return 503 when disabled");
    assert(quick.payload?.error === "QUICK_DISABLED", "quick should return QUICK_DISABLED");
  });

  await withServer({ DISABLE_RESET_WRITES: "true", CANARY_ALLOWLIST: "reset@example.com" }, async (baseUrl) => {
    const headers = await authHeaders(baseUrl, "reset@example.com");
    await onboard(baseUrl, headers);
    const today = await fetchJson(baseUrl, "/v1/rail/today", { headers });
    assert(today.payload?.ok, "rail/today should return ok when reset disabled");
    const dateKey = today.payload?.dateKey || today.payload?.dateISO;
    const resetId = today.payload?.reset?.id;

    const complete = await fetchJson(baseUrl, "/v1/reset/complete", {
      method: "POST",
      headers,
      body: { resetId, dateKey },
    });
    assert(complete.res.status === 503, "reset/complete should return 503 when disabled");
    assert(complete.payload?.error === "RESET_DISABLED", "reset/complete should return RESET_DISABLED");
  });
}

async function testWriteStorm() {
  await withServer(
    { WRITE_STORM_LIMIT: "2", WRITE_STORM_WINDOW_SEC: "5", CANARY_ALLOWLIST: "storm@example.com" },
    async (baseUrl) => {
      const headers = await authHeaders(baseUrl, "storm@example.com");
      await onboard(baseUrl, headers);
      const today = await fetchJson(baseUrl, "/v1/rail/today", { headers });
      assert(today.payload?.ok, "rail/today should return ok for storm test");
      const dateKey = today.payload?.dateKey || today.payload?.dateISO;
      const pastDateKey = addDaysISO(dateKey, -1);

      const idemKey = "storm-idem";
      const idemCheckIn = { stress: 4, sleepQuality: 6, energy: 6, timeAvailableMin: 10 };
      const idem1 = await fetchJson(baseUrl, "/v1/checkin", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": idemKey },
        body: { checkIn: idemCheckIn, dateKey: pastDateKey },
      });
      const idem2 = await fetchJson(baseUrl, "/v1/checkin", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": idemKey },
        body: { checkIn: idemCheckIn, dateKey: pastDateKey },
      });
      assert(idem1.payload?.ok && idem2.payload?.ok, "idempotent checkin should return ok under storm guard");

      const stormCheckIn = { stress: 6, sleepQuality: 5, energy: 5, timeAvailableMin: 10 };
      const first = await fetchJson(baseUrl, "/v1/checkin", {
        method: "POST",
        headers,
        body: { checkIn: stormCheckIn, dateKey },
      });
      assert(first.payload?.ok, "first storm checkin should succeed");
      const second = await fetchJson(baseUrl, "/v1/checkin", {
        method: "POST",
        headers,
        body: { checkIn: stormCheckIn, dateKey },
      });
      assert(second.payload?.ok, "second storm checkin should succeed");
      const third = await fetchJson(baseUrl, "/v1/checkin", {
        method: "POST",
        headers,
        body: { checkIn: stormCheckIn, dateKey },
      });
      assert(third.res.status === 429, "storm checkin should return 429 when limit exceeded");
      assert(third.payload?.error === "WRITE_STORM", "storm checkin should return WRITE_STORM");
    }
  );
}

async function testLibVersionFreeze() {
  const PORT = String(4200 + Math.floor(Math.random() * 500));
  const DATA_DIR = path.join(ROOT, "data", `test-freeze-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const mismatch = LIB_VERSION === "9999" ? "9998" : "9999";
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
    FREEZE_LIB_VERSION: "true",
    EXPECTED_LIB_VERSION: mismatch,
  };
  const server = spawn("node", ["src/server/index.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 3000);
    server.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
  if (exited.timeout) {
    server.kill("SIGTERM");
    throw new Error("server should exit on LIB_VERSION freeze mismatch");
  }
  assert(exited.code !== 0, "server should exit non-zero on LIB_VERSION freeze mismatch");
}

async function run() {
  await testCanaryGating();
  await testWritesDisabled();
  await testGranularKillSwitches();
  await testWriteStorm();
  await testLibVersionFreeze();
  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
