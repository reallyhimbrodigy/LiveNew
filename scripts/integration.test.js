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

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayISOInTimeZone(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return todayISO();
  }
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
    DB_PATH: path.join(DATA_DIR, "livenew.sqlite"),
    AUTH_REQUIRED: "false",
    ADMIN_EMAILS: "admin@example.com",
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

    const adminEmail = "admin@example.com";
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
      timezone: "America/Los_Angeles",
    };
    const userToday = todayISOInTimeZone(profile.timezone);
    const checkIn = {
      dateISO: userToday,
      stress: 2,
      sleepQuality: 8,
      energy: 7,
      timeAvailableMin: 20,
    };

    const onboard = await fetchJson("/v1/onboard/complete", {
      method: "POST",
      body: {
        email: adminEmail,
        userProfile: profile,
        firstCheckIn: checkIn,
      },
    });
    assert(onboard.payload?.ok, "onboard/complete should return ok");
    assert(onboard.payload?.weekPlan, "onboard/complete should include weekPlan");
    assert(onboard.payload?.day, "onboard/complete should include day");
    const adminAccess = onboard.payload?.accessToken || onboard.payload?.token;
    assert(adminAccess, "onboard/complete should return access token");

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

    const dayRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(dayRes.payload?.ok, "plan/day should succeed with access token");

    const refreshRes = await fetchJson("/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    assert(refreshRes.payload?.accessToken, "auth/refresh should return new accessToken");
    assert(refreshRes.payload?.refreshToken, "auth/refresh should return new refreshToken");
    assert(refreshRes.payload.refreshToken !== refreshToken, "refresh should rotate token");

    await fetchJson("/v1/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { checkIn: { dateISO: userToday, stress: 3, sleepQuality: 7, energy: 6, timeAvailableMin: 20 } },
    });
    await fetchJson("/v1/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { checkIn: { dateISO: userToday, stress: 4, sleepQuality: 6, energy: 5, timeAvailableMin: 60 } },
    });

    const mergedDayRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(
      mergedDayRes.payload?.day?.howLong?.timeAvailableMin === 60,
      "latest check-in should win for the day"
    );

    const beforeBackdate = JSON.stringify(mergedDayRes.payload?.day || {});
    const yesterday = addDaysISO(userToday, -1);
    const backdatedRes = await fetchJson("/v1/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { checkIn: { dateISO: yesterday, stress: 5, sleepQuality: 7, energy: 6, timeAvailableMin: 20 } },
    });
    assert(backdatedRes.payload?.backdated === true, "backdated check-in should be flagged");
    assert(
      Array.isArray(backdatedRes.payload?.rebuiltDates) && backdatedRes.payload.rebuiltDates.includes(yesterday),
      "backdated check-in should report rebuilt dates"
    );
    const afterBackdate = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(
      JSON.stringify(afterBackdate.payload?.day || {}) === beforeBackdate,
      "backdated check-in should not change today"
    );

    const whyRes = await fetchJson(`/v1/plan/why?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(whyRes.payload?.why?.expanded, "plan/why should return expanded explainability");
    assert("changeSummary" in (whyRes.payload || {}), "plan/why should include changeSummary");

    const historyBefore = await fetchJson(`/v1/plan/history/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    const beforeCount = historyBefore.payload?.history?.length || 0;
    await fetchJson("/v1/signal", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { dateISO: userToday, signal: "im_stressed" },
    });
    const historyAfter = await fetchJson(`/v1/plan/history/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    const afterCount = historyAfter.payload?.history?.length || 0;
    assert(afterCount >= beforeCount + 1, "signal should create a new day plan history entry");

    const adminRes = await fetchJson("/v1/admin/flags", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(adminRes.res.status === 403, "admin route should be forbidden for non-admin");

    const dayBefore = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    const signalRes = await fetchJson("/v1/signal", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { dateISO: userToday, signal: "wired" },
    });
    const dayAfter = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(
      JSON.stringify(dayBefore.payload?.day) !== JSON.stringify(dayAfter.payload?.day),
      "cache should invalidate after mutation"
    );
    assert(
      JSON.stringify(signalRes.payload?.day) === JSON.stringify(dayAfter.payload?.day),
      "day view should match latest mutation"
    );

    await fetchJson("/v1/complete", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { dateISO: userToday, part: "workout" },
    });
    await fetchJson("/v1/complete", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { dateISO: userToday, part: "reset" },
    });
    const analyticsRes = await fetchJson(`/v1/admin/analytics/daily?from=${userToday}&to=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    const dayRow = (analyticsRes.payload?.days || []).find((entry) => entry.dateISO === userToday);
    assert(
      dayRow?.daysWithAnyRegulationActionCompleted === 1,
      "north-star should count only once per user per day"
    );

    let rateLimited = false;
    for (let i = 0; i < 7; i += 1) {
      const res = await fetchJson("/v1/auth/request", {
        method: "POST",
        body: { email: `ratelimit${i}@example.com` },
      });
      if (res.res.status === 429) rateLimited = true;
    }
    assert(rateLimited, "auth rate limit should trigger");

    const exportRes = await fetchJson("/v1/account/export", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    const exportText = JSON.stringify(exportRes.payload?.export || {});
    assert(!/refreshToken|accessToken|tokenHash/i.test(exportText), "export should not include tokens");

    const deleteMissingHeader = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(deleteMissingHeader.res.status === 400, "delete should require confirm header");

    const deleteMissingBody = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminAccess}`, "x-confirm-delete": "DELETE" },
    });
    assert(deleteMissingBody.res.status === 400, "delete should require confirm phrase");

    const deleteOk = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminAccess}`, "x-confirm-delete": "DELETE" },
      body: { confirm: "LiveNew" },
    });
    assert(deleteOk.payload?.ok, "delete should succeed with confirmations");

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
