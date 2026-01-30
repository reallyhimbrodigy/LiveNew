import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const BASE_URL = process.env.BASE_URL || process.env.SIM_BASE_URL || "http://127.0.0.1:3000";
const AUTH_TOKEN = process.env.AUTH_TOKEN || process.env.SIM_AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const EMAIL = process.env.SMOKE_EMAIL || process.env.SIM_EMAIL || "maintenance@example.com";
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "livenew.sqlite");

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

async function fetchOutcomes(authHeaders, days) {
  const res = await fetchJson(`/v1/outcomes?days=${days}`, { headers: authHeaders });
  assertOk(res.payload?.ok, `outcomes ${days} should return ok`);
  return res.payload;
}

function snapshotOutcomes(outcomes) {
  return {
    range: outcomes.range,
    metrics: outcomes.metrics,
  };
}

export function compareOutcomes(before, after) {
  if (!before || !after) return false;
  return JSON.stringify(snapshotOutcomes(before)) === JSON.stringify(snapshotOutcomes(after));
}

function countEventsForUser(db, userId) {
  const daily = db
    .prepare("SELECT COUNT(*) AS count FROM daily_events WHERE user_id = ?")
    .get(userId)?.count;
  const weekState = db
    .prepare("SELECT COUNT(*) AS count FROM week_state WHERE user_id = ?")
    .get(userId)?.count;
  const dayState = db
    .prepare("SELECT COUNT(*) AS count FROM day_state WHERE user_id = ?")
    .get(userId)?.count;
  const idem = db
    .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE user_id = ?")
    .get(userId)?.count;
  return {
    dailyEvents: daily ?? 0,
    weekState: weekState ?? 0,
    dayState: dayState ?? 0,
    idempotencyKeys: idem ?? 0,
  };
}

function runNode(scriptPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function main() {
  await fs.stat(DB_PATH);
  const authHeaders = {};
  const bootstrap = await ensureBootstrapAndOnboard(authHeaders);
  const userId = bootstrap?.auth?.userId;
  assertOk(userId, "userId required for maintenance verify");

  const pre = {
    outcomes7: await fetchOutcomes(authHeaders, 7),
    outcomes14: await fetchOutcomes(authHeaders, 14),
    outcomes30: await fetchOutcomes(authHeaders, 30),
  };
  const db = new DatabaseSync(DB_PATH);
  const preCounts = countEventsForUser(db, userId);
  db.close();

  const maintenance = await runNode(path.join(ROOT, "scripts", "maintenance-weekly.js"));
  assertOk(maintenance.ok, `maintenance-weekly failed: ${maintenance.stderr || maintenance.stdout}`);

  const post = {
    outcomes7: await fetchOutcomes(authHeaders, 7),
    outcomes14: await fetchOutcomes(authHeaders, 14),
    outcomes30: await fetchOutcomes(authHeaders, 30),
  };
  const dbAfter = new DatabaseSync(DB_PATH);
  const postCounts = countEventsForUser(dbAfter, userId);
  dbAfter.close();

  assertOk(compareOutcomes(pre.outcomes7, post.outcomes7), "outcomes 7 changed after maintenance");
  assertOk(compareOutcomes(pre.outcomes14, post.outcomes14), "outcomes 14 changed after maintenance");
  assertOk(compareOutcomes(pre.outcomes30, post.outcomes30), "outcomes 30 changed after maintenance");
  assertOk(preCounts.dailyEvents === postCounts.dailyEvents, "daily_events changed after maintenance");
  assertOk(preCounts.weekState === postCounts.weekState, "week_state changed after maintenance");
  assertOk(preCounts.dayState === postCounts.dayState, "day_state changed after maintenance");

  const report = {
    ok: true,
    userId,
    pre: { outcomes: { days7: snapshotOutcomes(pre.outcomes7), days14: snapshotOutcomes(pre.outcomes14), days30: snapshotOutcomes(pre.outcomes30) }, counts: preCounts },
    post: { outcomes: { days7: snapshotOutcomes(post.outcomes7), days14: snapshotOutcomes(post.outcomes14), days30: snapshotOutcomes(post.outcomes30) }, counts: postCounts },
    maintenance: maintenance.stdout || null,
  };

  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = (() => {
  try {
    return import.meta.url === new URL(process.argv[1], "file://").href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exit(1);
  });
}
