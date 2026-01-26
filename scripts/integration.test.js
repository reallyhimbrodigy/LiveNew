import { spawn } from "child_process";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import fs from "fs/promises";

const ROOT = process.cwd();
const PORT = String(3900 + Math.floor(Math.random() * 500));
const DATA_DIR = path.join(ROOT, "data", `test-int-${Date.now()}`);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
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

async function run() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const env = {
    ...process.env,
    ENV_MODE: "dev",
    PORT,
    DATA_DIR,
    AUTH_REQUIRED: "false",
  };
  const server = spawn("node", ["src/server/index.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  server.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  try {
    await waitForReady();

    const profile = {
      wakeTime: "07:00",
      bedTime: "23:00",
      sleepRegularity: 6,
      caffeineCupsPerDay: 1,
      lateCaffeineDaysPerWeek: 1,
      sunlightMinutesPerDay: 10,
      lateScreenMinutesPerNight: 30,
      alcoholNightsPerWeek: 1,
      mealTimingConsistency: 6,
      contentPack: "balanced_routine",
    };
    const checkIn = {
      dateISO: todayISO(),
      stress: 2,
      sleepQuality: 8,
      energy: 7,
      timeAvailableMin: 20,
    };

    const onboard = await fetchJson("/v1/onboard/complete", {
      method: "POST",
      body: {
        email: "onboard@example.com",
        userProfile: profile,
        firstCheckIn: checkIn,
      },
    });
    assert(onboard.payload?.ok, "onboard/complete should return ok");
    assert(onboard.payload?.weekPlan, "onboard/complete should include weekPlan");
    assert(onboard.payload?.day, "onboard/complete should include day");
    const onboardAccess = onboard.payload?.accessToken || onboard.payload?.token;
    assert(onboardAccess, "onboard/complete should return access token");

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
    assert(verifyRes.payload?.refreshToken, "auth/verify should return refreshToken");

    const accessToken = verifyRes.payload.accessToken;
    const refreshToken = verifyRes.payload.refreshToken;

    const dayRes = await fetchJson(`/v1/plan/day?date=${todayISO()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    assert(dayRes.payload?.ok, "plan/day should succeed with access token");

    const refreshRes = await fetchJson("/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    assert(refreshRes.payload?.accessToken, "auth/refresh should return new accessToken");
    assert(refreshRes.payload?.refreshToken, "auth/refresh should return new refreshToken");
    assert(refreshRes.payload.refreshToken !== refreshToken, "refresh should rotate token");

    const historyBefore = await fetchJson(`/v1/plan/history/day?date=${todayISO()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    const beforeCount = historyBefore.payload?.history?.length || 0;
    await fetchJson("/v1/signal", {
      method: "POST",
      headers: { Authorization: `Bearer ${onboardAccess}` },
      body: { dateISO: todayISO(), signal: "im_stressed" },
    });
    const historyAfter = await fetchJson(`/v1/plan/history/day?date=${todayISO()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    const afterCount = historyAfter.payload?.history?.length || 0;
    assert(afterCount >= beforeCount + 1, "signal should create a new day plan history entry");

    const adminRes = await fetchJson("/v1/admin/flags", {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    assert(adminRes.res.status === 403, "admin route should be forbidden for non-admin");

    const dayBefore = await fetchJson(`/v1/plan/day?date=${todayISO()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    const signalRes = await fetchJson("/v1/signal", {
      method: "POST",
      headers: { Authorization: `Bearer ${onboardAccess}` },
      body: { dateISO: todayISO(), signal: "wired" },
    });
    const dayAfter = await fetchJson(`/v1/plan/day?date=${todayISO()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${onboardAccess}` },
    });
    assert(
      JSON.stringify(dayBefore.payload?.day) !== JSON.stringify(dayAfter.payload?.day),
      "cache should invalidate after mutation"
    );
    assert(
      JSON.stringify(signalRes.payload?.day) === JSON.stringify(dayAfter.payload?.day),
      "day view should match latest mutation"
    );

    console.log("PASS integration tests");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.on("exit", resolve));
  }
}

run().catch((err) => {
  console.error("FAIL integration tests", err);
  process.exit(1);
});
