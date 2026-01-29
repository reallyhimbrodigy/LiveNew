import { spawn } from "child_process";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import fs from "fs/promises";
import crypto from "crypto";

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

function todayISOWithBoundary(timeZone, dayBoundaryHour = 4) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const map = {};
    parts.forEach((part) => {
      if (part.type !== "literal") map[part.type] = part.value;
    });
    const dateISO = `${map.year}-${map.month}-${map.day}`;
    const hour = Number(map.hour || 0);
    if (Number.isFinite(hour) && hour < dayBoundaryHour) {
      return addDaysISO(dateISO, -1);
    }
    return dateISO;
  } catch {
    return todayISO();
  }
}

function hashBucket(userId, experimentId) {
  const hash = crypto.createHash("sha256").update(`${userId}:${experimentId}`).digest("hex");
  const head = hash.slice(0, 8);
  const value = Number.parseInt(head, 16);
  if (!Number.isFinite(value)) return 0;
  return value % 100;
}

function chooseVariant(userId, experimentId, variants, percent = 100) {
  const bucket = hashBucket(userId, experimentId);
  const pct = Math.max(0, Math.min(100, Math.floor(Number(percent) || 100)));
  if (bucket >= pct) return null;
  const index = variants.length ? bucket % variants.length : -1;
  return index >= 0 ? variants[index] : null;
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

function assertErrorPayload(payload, label) {
  assert(payload && payload.ok === false, `${label} should return ok:false`);
  assert(payload.error && typeof payload.error.code === "string", `${label} should include error.code`);
  assert(payload.error && typeof payload.error.message === "string", `${label} should include error.message`);
  assert(payload.error && typeof payload.error.requestId === "string", `${label} should include error.requestId`);
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
    TEST_MODE: "true",
    PORT,
    DATA_DIR,
    DB_PATH: path.join(DATA_DIR, "livenew.sqlite"),
    AUTH_REQUIRED: "false",
    ADMIN_EMAILS: "admin@example.com,admin2@example.com",
    ADMIN_IN_DEV: "true",
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
    await fetchJson("/v1/dev/route-hits/reset", { method: "POST" });

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
      dayBoundaryHour: 4,
    };
    const userToday = todayISOWithBoundary(profile.timezone, profile.dayBoundaryHour);
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
        consent: { terms: true, privacy: true, alphaProcessing: true },
        userProfile: profile,
        firstCheckIn: checkIn,
      },
    });
    assert(onboard.payload?.ok, "onboard/complete should return ok");
    assert(onboard.payload?.weekPlan, "onboard/complete should include weekPlan");
    assert(onboard.payload?.day, "onboard/complete should include day");
    const adminAccess = onboard.payload?.accessToken || onboard.payload?.token;
    assert(adminAccess, "onboard/complete should return access token");

    const adminEmail2 = "admin2@example.com";
    const onboard2 = await fetchJson("/v1/onboard/complete", {
      method: "POST",
      body: {
        email: adminEmail2,
        consent: { terms: true, privacy: true, alphaProcessing: true },
        userProfile: profile,
        firstCheckIn: checkIn,
      },
    });
    assert(onboard2.payload?.ok, "second admin onboard should return ok");
    const adminAccess2 = onboard2.payload?.accessToken || onboard2.payload?.token;
    assert(adminAccess2, "second admin onboard should return access token");

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

    const bootstrapPre = await fetchJson("/v1/bootstrap", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(bootstrapPre.payload?.uiState === "consent", "bootstrap uiState should be consent");

    const hitsPre = await fetchJson("/v1/dev/route-hits", { method: "GET" });
    const planDayHits = hitsPre.payload?.hits?.["GET /v1/plan/day"] || 0;
    const planWeekHits = hitsPre.payload?.hits?.["GET /v1/plan/week"] || 0;
    const railTodayHits = hitsPre.payload?.hits?.["GET /v1/rail/today"] || 0;
    assert(planDayHits === 0, "plan/day should not be hit before consent");
    assert(planWeekHits === 0, "plan/week should not be hit before consent");
    assert(railTodayHits === 0, "rail/today should not be hit before consent");

    const missingRoute = await fetchJson("/v1/does-not-exist", { method: "GET" });
    assert(missingRoute.res.status === 404, "unknown route should return 404");
    assertErrorPayload(missingRoute.payload, "404");

    const unauthPlan = await fetchJson(`/v1/plan/day?date=${userToday}`, { method: "GET" });
    assert(unauthPlan.res.status >= 400, "plan/day without auth should fail");
    assertErrorPayload(unauthPlan.payload, "plan/day without auth");

    const preConsentRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(preConsentRes.res.status === 403, "plan/day should be blocked before consent");
    assert(
      ["consent_required", "consent_required_version"].includes(preConsentRes.payload?.error?.code),
      "consent error expected"
    );
    assertErrorPayload(preConsentRes.payload, "plan/day pre-consent");

    const consentStatus = await fetchJson("/v1/consent/status", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(consentStatus.payload?.ok, "consent/status should return ok");
    assert(consentStatus.payload?.accepted?.terms === false, "consent/status should reflect missing consent");

    const consentAccept = await fetchJson("/v1/consent/accept", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { accept: { terms: true, privacy: true, alphaProcessing: true } },
    });
    assert(consentAccept.payload?.ok, "consent/accept should return ok");

    const bootstrapPost = await fetchJson("/v1/bootstrap", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(bootstrapPost.payload?.uiState === "home", "bootstrap uiState should be home after consent");

    await fetchJson("/v1/profile", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { userProfile: { ...profile, contentPack: "calm_reset", timezone: profile.timezone } },
    });

    const railRes = await fetchJson("/v1/rail/today", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(railRes.payload?.ok, "rail/today should succeed after consent");

    const dayRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
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
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { checkIn: { dateISO: userToday, stress: 3, sleepQuality: 7, energy: 6, timeAvailableMin: 20 } },
    });
    await fetchJson("/v1/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { checkIn: { dateISO: userToday, stress: 4, sleepQuality: 6, energy: 5, timeAvailableMin: 60 } },
    });

    const mergedDayRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(
      mergedDayRes.payload?.day?.howLong?.timeAvailableMin === 60,
      "latest check-in should win for the day"
    );

    const beforeBackdate = JSON.stringify(mergedDayRes.payload?.day || {});
    const yesterday = addDaysISO(userToday, -1);
    const backdatedRes = await fetchJson("/v1/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { checkIn: { dateISO: yesterday, stress: 5, sleepQuality: 7, energy: 6, timeAvailableMin: 20 } },
    });
    assert(backdatedRes.payload?.backdated === true, "backdated check-in should be flagged");
    assert(
      Array.isArray(backdatedRes.payload?.rebuiltDates) && backdatedRes.payload.rebuiltDates.includes(yesterday),
      "backdated check-in should report rebuilt dates"
    );
    const afterBackdate = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(
      JSON.stringify(afterBackdate.payload?.day || {}) === beforeBackdate,
      "backdated check-in should not change today"
    );

    const whyRes = await fetchJson(`/v1/plan/why?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(whyRes.payload?.why?.expanded, "plan/why should return expanded explainability");
    assert("changeSummary" in (whyRes.payload || {}), "plan/why should include changeSummary");

    const railRes = await fetchJson("/v1/rail/today", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(railRes.payload?.rail?.reset, "rail/today should return a reset");
    assert(railRes.payload?.day, "rail/today should return a day contract");

    const citationsRes = await fetchJson("/v1/citations", { method: "GET" });
    assert(Array.isArray(citationsRes.payload?.citations) && citationsRes.payload.citations.length > 0, "citations should load");

    const matrixRes = await fetchJson("/v1/admin/preview/matrix", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { packIds: ["balanced_routine"], profiles: ["Balanced"], timeBuckets: [10, 20] },
    });
    assert(matrixRes.payload?.ok, "admin preview matrix should succeed");
    assert(Array.isArray(matrixRes.payload?.matrix) && matrixRes.payload.matrix.length >= 2, "matrix should have rows");

    const scId = `r_test_reset_${Date.now()}`;
    const scItem = {
      id: scId,
      title: "Test reset",
      tags: ["downshift", "breathe"],
      minutes: 2,
      steps: ["Inhale slowly", "Exhale longer"],
      priority: 1,
    };
    const draftRes = await fetchJson("/v1/admin/content/draft", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: { kind: "reset", item: scItem },
    });
    assert(draftRes.payload?.item?.status === "draft", "content draft should set draft status");
    const stageRes = await fetchJson(`/v1/admin/content/stage/reset/${scId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: {},
    });
    assert(stageRes.payload?.item?.status === "staged", "content stage should set staged status");
    const enableRes = await fetchJson(`/v1/admin/content/enable/reset/${scId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: {},
    });
    assert(enableRes.payload?.item?.status === "enabled", "content enable should set enabled status");
    const validateRes = await fetchJson("/v1/admin/content/validate", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: { scope: "enabled" },
    });
    assert(validateRes.payload?.report, "content validate should return a report");

    const searchRes = await fetchJson(`/v1/admin/users/search?email=${encodeURIComponent("test@example.com")}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(searchRes.payload?.user?.userId, "admin user search should return userId");
    const targetUserId = searchRes.payload.user.userId;

    const experimentConfig = {
      type: "pack",
      variants: [
        { key: "A", packId: "balanced_routine" },
        { key: "B", packId: "calm_reset" },
      ],
      targeting: { percent: 100 },
    };
    const experimentCreateRes = await fetchJson("/v1/admin/experiments", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: { name: "pack-exp", status: "draft", config_json: experimentConfig },
    });
    const experimentId = experimentCreateRes.payload?.experiment?.id;
    assert(experimentId, "experiment create should return id");
    await fetchJson(`/v1/admin/experiments/${experimentId}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: {},
    });
    const expectedVariant = chooseVariant(
      targetUserId,
      experimentId,
      experimentConfig.variants,
      experimentConfig.targeting.percent
    );
    assert(expectedVariant?.packId, "expected experiment variant should resolve");
    await fetchJson("/v1/plan/force-refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { dateISO: userToday },
    });
    const experimentDayRes = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(
      experimentDayRes.payload?.day?.why?.packMatch?.packId === expectedVariant.packId,
      "pack experiment should override effective pack"
    );
    await fetchJson(`/v1/admin/experiments/${experimentId}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: {},
    });

    const guardrailConfig = {
      type: "parameters",
      variants: [
        { key: "A", paramsOverride: { profileThresholds: {} } },
        { key: "B", paramsOverride: { timeBuckets: { allowed: [5, 10, 15], default: 10 } } },
      ],
      targeting: { percent: 100 },
    };
    const guardrailRes = await fetchJson("/v1/admin/experiments", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess2}` },
      body: { name: "guardrail-exp", status: "draft", config_json: guardrailConfig },
    });
    assert(
      guardrailRes.res.status === 400 && guardrailRes.payload?.error?.code === "experiment_guardrail_violation",
      "experiment guardrails should reject safety overrides"
    );

    const bundleRes = await fetchJson(`/v1/admin/users/${targetUserId}/debug-bundle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: {},
    });
    assert(bundleRes.payload?.bundleId, "debug bundle should return bundleId");

    const bundleReadRes = await fetchJson(`/v1/admin/debug-bundles/${bundleRes.payload.bundleId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminAccess}` },
    });
    assert(bundleReadRes.payload?.bundle?.redacted, "debug bundle read should return redacted payload");

    const replayRes = await fetchJson(`/v1/admin/users/${targetUserId}/replay-sandbox`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: {},
    });
    assert(replayRes.payload?.ok, "replay sandbox should succeed");

    const changelogCreate = await fetchJson("/v1/admin/changelog", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { version: "alpha-0.1", title: "Alpha note", notes: "Testing user notes", audience: "user" },
    });
    assert(changelogCreate.payload?.entry?.id, "admin changelog create should return entry");
    const userChangelog = await fetchJson("/v1/changelog?audience=user&limit=5", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(
      (userChangelog.payload?.items || []).some((item) => item.id === changelogCreate.payload.entry.id),
      "user changelog should include created entry"
    );

    const historyBefore = await fetchJson(`/v1/plan/history/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const beforeCount = historyBefore.payload?.history?.length || 0;
    const dayBefore = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const signalRes = await fetchJson("/v1/signal", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { dateISO: userToday, signal: "wired" },
    });
    const historyAfter = await fetchJson(`/v1/plan/history/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const afterCount = historyAfter.payload?.history?.length || 0;
    assert(afterCount >= beforeCount + 1, "signal should create a new day plan history entry");
    const dayAfter = await fetchJson(`/v1/plan/day?date=${userToday}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(
      JSON.stringify(dayBefore.payload?.day) !== JSON.stringify(dayAfter.payload?.day),
      "cache should invalidate after mutation"
    );
    assert(
      JSON.stringify(signalRes.payload?.day) === JSON.stringify(dayAfter.payload?.day),
      "day view should match latest mutation"
    );

	    const adminRes = await fetchJson("/v1/admin/flags", {
	      method: "GET",
	      headers: { Authorization: `Bearer ${accessToken}` },
	    });
	    assert(adminRes.res.status === 403, "admin route should be forbidden for non-admin");

	    await fetchJson("/v1/complete", {
	      method: "POST",
	      headers: { Authorization: `Bearer ${accessToken}` },
	      body: { dateISO: userToday, part: "workout" },
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
	    for (let i = 0; i < 25; i += 1) {
	      const res = await fetchJson("/v1/auth/request", {
	        method: "POST",
	        body: { email: `ratelimit${i}@example.com` },
	      });
	      if (res.res.status === 429) rateLimited = true;
	    }
    assert(rateLimited, "auth rate limit should trigger");

    const exportRes = await fetchJson("/v1/account/export", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const exportText = JSON.stringify(exportRes.payload?.export || {});
    assert(!/refreshToken|accessToken|tokenHash/i.test(exportText), "export should not include tokens");

    const deleteMissingHeader = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(deleteMissingHeader.res.status === 400, "delete should require confirm header");

    const deleteMissingBody = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, "x-confirm-delete": "DELETE" },
    });
    assert(deleteMissingBody.res.status === 400, "delete should require confirm phrase");

    const deleteOk = await fetchJson("/v1/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, "x-confirm-delete": "DELETE" },
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
