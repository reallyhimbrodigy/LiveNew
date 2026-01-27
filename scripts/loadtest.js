const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USERS = Math.max(1, Number(process.env.USERS || 50));
const JITTER_MS = Math.max(0, Number(process.env.JITTER_MS || 25));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter() {
  if (!JITTER_MS) return Promise.resolve();
  const ms = Math.floor(Math.random() * JITTER_MS);
  return sleep(ms);
}

const metrics = new Map();

function record(endpoint, ms, ok) {
  if (!metrics.has(endpoint)) {
    metrics.set(endpoint, { latencies: [], errors: 0, count: 0 });
  }
  const entry = metrics.get(endpoint);
  entry.count += 1;
  if (!ok) entry.errors += 1;
  if (Number.isFinite(ms)) entry.latencies.push(ms);
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
    };
  }
  return out;
}

async function request(endpoint, userId, { method = "GET", path = "/", body = null } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "x-livenew-user": userId,
    "x-client-type": "api",
  };
  const init = { method, headers };
  if (body != null) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const ms = Date.now() - start;
    record(endpoint, ms, res.ok);
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    return { ok: res.ok, status: res.status, payload };
  } catch (err) {
    const ms = Date.now() - start;
    record(endpoint, ms, false);
    return { ok: false, status: 0, payload: { error: String(err) } };
  }
}

function buildProfile(userId) {
  return {
    userProfile: {
      id: userId,
      timezone: "America/Los_Angeles",
      dayBoundaryHour: 4,
      contentPack: "balanced_routine",
      wakeTime: "07:00",
      bedTime: "23:00",
      sleepRegularity: 6,
      caffeineCupsPerDay: 1,
      lateCaffeineDaysPerWeek: 1,
      sunlightMinutesPerDay: 15,
      lateScreenMinutesPerNight: 30,
      alcoholNightsPerWeek: 1,
      mealTimingConsistency: 6,
      preferredWorkoutWindows: ["PM"],
      busyDays: [],
    },
  };
}

async function simulateUser(i) {
  const userId = `loaduser_${i}`;
  await jitter();

  await request("POST /v1/profile", userId, {
    method: "POST",
    path: "/v1/profile",
    body: buildProfile(userId),
  });

  await jitter();
  const rail = await request("GET /v1/rail/today", userId, {
    method: "GET",
    path: "/v1/rail/today",
  });

  const dateISO =
    rail.payload?.day?.dateISO || new Date().toISOString().slice(0, 10);
  const checkIn = {
    checkIn: {
      dateISO,
      stress: 5,
      sleepQuality: 6,
      energy: 6,
      timeAvailableMin: 10,
    },
  };

  await jitter();
  await request("POST /v1/checkin", userId, {
    method: "POST",
    path: "/v1/checkin",
    body: checkIn,
  });

  await jitter();
  await request("POST /v1/complete", userId, {
    method: "POST",
    path: "/v1/complete",
    body: { dateISO, part: "reset" },
  });

  await jitter();
  await request("GET /v1/plan/day", userId, {
    method: "GET",
    path: `/v1/plan/day?date=${encodeURIComponent(dateISO)}`,
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const users = Array.from({ length: USERS }, (_, i) => i + 1);
  await Promise.all(users.map((i) => simulateUser(i)));
  const durationMs = Date.now() - start;
  const summary = {
    ok: true,
    baseUrl: BASE_URL,
    users: USERS,
    startedAt,
    durationMs,
    metrics: summarize(),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err) }));
  process.exitCode = 1;
});
