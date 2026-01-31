// Runbook: set BASE_URL and AUTH_TOKEN. Optional: USERS, JITTER_MS, P95_*_MAX_MS thresholds.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PRESET = process.env.LOAD_TEST_PRESET || process.env.PERF_PRESET || "";
const USERS = Math.max(1, Number(process.env.USERS || (PRESET === "prod" ? 200 : 50)));
const JITTER_MS = Math.max(0, Number(process.env.JITTER_MS || (PRESET === "prod" ? 10 : 25)));
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const ROUNDS = Math.max(1, Number(process.env.LOAD_TEST_ROUNDS || (PRESET === "prod" ? 3 : 1)));
const P95_THRESHOLDS = {
  "GET /v1/rail/today": Number(process.env.P95_TODAY_MAX_MS || ""),
  "GET /v1/outcomes": Number(process.env.P95_OUTCOMES_MAX_MS || ""),
  "GET /v1/plan/day": Number(process.env.P95_PLAN_DAY_MAX_MS || ""),
  "POST /v1/checkin": Number(process.env.P95_CHECKIN_MAX_MS || ""),
};
const P99_THRESHOLDS = {
  "GET /v1/rail/today": Number(process.env.P99_TODAY_MAX_MS || ""),
  "GET /v1/outcomes": Number(process.env.P99_OUTCOMES_MAX_MS || ""),
  "GET /v1/plan/day": Number(process.env.P99_PLAN_DAY_MAX_MS || ""),
  "POST /v1/checkin": Number(process.env.P99_CHECKIN_MAX_MS || ""),
};

function normalizeThreshold(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter() {
  if (!JITTER_MS) return Promise.resolve();
  const ms = Math.floor(Math.random() * JITTER_MS);
  return sleep(ms);
}

const metrics = new Map();

function record(endpoint, ms, ok, status) {
  if (!metrics.has(endpoint)) {
    metrics.set(endpoint, { latencies: [], errors: 0, count: 0, statusCounts: {} });
  }
  const entry = metrics.get(endpoint);
  entry.count += 1;
  if (!ok) entry.errors += 1;
  if (Number.isFinite(ms)) entry.latencies.push(ms);
  const statusKey = Number.isFinite(status) ? String(status) : "unknown";
  entry.statusCounts[statusKey] = (entry.statusCounts[statusKey] || 0) + 1;
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function summarize() {
  const out = {};
  for (const [endpoint, entry] of metrics.entries()) {
    const latencies = entry.latencies;
    const total = latencies.reduce((sum, v) => sum + v, 0);
    out[endpoint] = {
      count: entry.count,
      errors: entry.errors,
      errorRate: entry.count ? entry.errors / entry.count : 0,
      avgMs: latencies.length ? total / latencies.length : null,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      statusCounts: entry.statusCounts,
    };
  }
  return out;
}

async function request(endpoint, userId, { method = "GET", path = "/", body = null, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;
  const reqHeaders = {
    "x-livenew-user": userId,
    "x-client-type": "api",
    ...headers,
  };
  if (AUTH_TOKEN) reqHeaders.Authorization = AUTH_TOKEN;
  const init = { method, headers: reqHeaders };
  if (body != null) {
    reqHeaders["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const ms = Date.now() - start;
    const ok = res.ok || res.status === 304;
    record(endpoint, ms, ok, res.status);
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    return { ok, status: res.status, payload, headers: res.headers };
  } catch (err) {
    const ms = Date.now() - start;
    record(endpoint, ms, false, 0);
    return { ok: false, status: 0, payload: { error: String(err) }, headers: new Headers() };
  }
}

async function ensureBaseline(userId, dateISO) {
  const baseline = {
    timezone: "America/Los_Angeles",
    dayBoundaryHour: 4,
    constraints: { equipment: { none: true } },
  };
  const firstCheckIn = { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10, dateISO };
  return request("POST /v1/onboard/complete", userId, {
    method: "POST",
    path: "/v1/onboard/complete",
    body: { consent: { terms: true, privacy: true, alphaProcessing: true }, baseline, firstCheckIn },
  });
}

async function simulateUser(i) {
  const userId = `loaduser_${i}`;
  await jitter();

  let rail = await request("GET /v1/rail/today", userId, {
    method: "GET",
    path: "/v1/rail/today",
  });

  if (rail.payload?.error === "baseline_required" || rail.payload?.error === "BOOTSTRAP_NOT_HOME") {
    const todayISO = new Date().toISOString().slice(0, 10);
    await ensureBaseline(userId, todayISO);
    await jitter();
    rail = await request("GET /v1/rail/today", userId, { method: "GET", path: "/v1/rail/today" });
  }

  const dateKey = rail.payload?.dateKey || rail.payload?.dateISO || new Date().toISOString().slice(0, 10);
  const etag = rail.headers?.get?.("etag") || rail.headers?.get?.("ETag") || null;

  await jitter();
  await request("GET /v1/rail/today", userId, {
    method: "GET",
    path: "/v1/rail/today",
    headers: etag ? { "If-None-Match": etag } : {},
  });

  const checkIn = { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 10 };
  const idempotencyKey = `loadtest-checkin-${userId}-${dateKey}`;
  await jitter();
  await request("POST /v1/checkin", userId, {
    method: "POST",
    path: "/v1/checkin",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { checkIn, dateKey },
  });

  await jitter();
  await request("GET /v1/plan/day", userId, {
    method: "GET",
    path: `/v1/plan/day?date=${encodeURIComponent(dateKey)}`,
  });

  await jitter();
  await request("GET /v1/outcomes", userId, {
    method: "GET",
    path: "/v1/outcomes?days=7",
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const users = Array.from({ length: USERS }, (_, i) => i + 1);
  for (let round = 0; round < ROUNDS; round += 1) {
    await Promise.all(users.map((i) => simulateUser(i)));
  }
  const durationMs = Date.now() - start;
  const metricsSummary = summarize();
  const regressions = [];
  Object.entries(P95_THRESHOLDS).forEach(([endpoint, limitRaw]) => {
    const limit = normalizeThreshold(limitRaw);
    if (!limit) return;
    const p95 = metricsSummary?.[endpoint]?.p95Ms;
    if (Number.isFinite(p95) && p95 > limit) {
      regressions.push({ endpoint, p95Ms: p95, limitMs: limit });
    }
  });
  Object.entries(P99_THRESHOLDS).forEach(([endpoint, limitRaw]) => {
    const limit = normalizeThreshold(limitRaw);
    if (!limit) return;
    const p99 = metricsSummary?.[endpoint]?.p99Ms;
    if (Number.isFinite(p99) && p99 > limit) {
      regressions.push({ endpoint, p99Ms: p99, limitMs: limit });
    }
  });
  const ok = regressions.length === 0;
  const summary = {
    ok,
    baseUrl: BASE_URL,
    users: USERS,
    rounds: ROUNDS,
    preset: PRESET || null,
    startedAt,
    durationMs,
    metrics: metricsSummary,
    regressions,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }));
  process.exitCode = 1;
});
