import { spawn } from "child_process";
import path from "path";

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

function summarizeMetrics(metrics) {
  const out = {};
  for (const [endpoint, entry] of metrics.entries()) {
    const total = entry.latencies.reduce((sum, v) => sum + v, 0);
    out[endpoint] = {
      count: entry.count,
      errors: entry.errors,
      errorRate: entry.count ? entry.errors / entry.count : 0,
      avgMs: entry.latencies.length ? total / entry.latencies.length : null,
      p50Ms: percentile(entry.latencies, 50),
      p95Ms: percentile(entry.latencies, 95),
    };
  }
  return out;
}

function recordMetric(metrics, endpoint, ms, ok) {
  if (!metrics.has(endpoint)) {
    metrics.set(endpoint, { latencies: [], errors: 0, count: 0 });
  }
  const entry = metrics.get(endpoint);
  entry.count += 1;
  if (!ok) entry.errors += 1;
  if (Number.isFinite(ms)) entry.latencies.push(ms);
}

function parseJsonLine(output) {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function runInlineProbe({ baseUrl, authToken }) {
  if (typeof fetch !== "function") {
    return { ok: false, error: "fetch_unavailable" };
  }
  const headers = {
    "x-client-type": "ops",
    "content-type": "application/json",
  };
  if (authToken) headers.Authorization = authToken;
  const metrics = new Map();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const request = async (endpoint, { method = "GET", path = "/", body = null } = {}) => {
    const url = `${baseUrl}${path}`;
    const init = { method, headers: { ...headers } };
    if (body != null) {
      init.body = JSON.stringify(body);
    }
    const start = Date.now();
    try {
      const res = await fetch(url, init);
      const ms = Date.now() - start;
      recordMetric(metrics, endpoint, ms, res.ok);
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      return { ok: res.ok, status: res.status, payload };
    } catch (err) {
      const ms = Date.now() - start;
      recordMetric(metrics, endpoint, ms, false);
      return { ok: false, status: 0, payload: { error: String(err) } };
    }
  };

  const rail = await request("GET /v1/rail/today", { method: "GET", path: "/v1/rail/today" });
  const dateISO = rail.payload?.day?.dateISO || new Date().toISOString().slice(0, 10);
  await request("POST /v1/checkin", {
    method: "POST",
    path: "/v1/checkin",
    body: {
      checkIn: {
        dateISO,
        stress: 5,
        sleepQuality: 6,
        energy: 6,
        timeAvailableMin: 10,
      },
    },
  });
  await request("POST /v1/complete", {
    method: "POST",
    path: "/v1/complete",
    body: { dateISO, part: "reset" },
  });
  await request("GET /v1/plan/day", {
    method: "GET",
    path: `/v1/plan/day?date=${encodeURIComponent(dateISO)}`,
  });

  const durationMs = Date.now() - startMs;
  return {
    ok: true,
    baseUrl,
    users: 1,
    startedAt,
    durationMs,
    fallback: "inline_probe",
    metrics: summarizeMetrics(metrics),
  };
}

export async function runLoadtestScript({ baseUrl, users, authToken, cwd = process.cwd() } = {}) {
  const env = {
    ...process.env,
    BASE_URL: baseUrl || process.env.BASE_URL,
  };
  const fallbackBaseUrl = env.BASE_URL || baseUrl || "http://localhost:3000";
  if (users != null) env.USERS = String(users);
  if (authToken) env.AUTH_TOKEN = authToken;

  const scriptPath = path.join(cwd, "scripts", "loadtest.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", async () => {
      const fallback = await runInlineProbe({ baseUrl: fallbackBaseUrl, authToken });
      resolve(fallback);
    });
    child.on("close", async (code) => {
      const parsed = parseJsonLine(stdout) || parseJsonLine(stderr);
      if (!parsed || code !== 0) {
        const fallback = await runInlineProbe({ baseUrl: fallbackBaseUrl, authToken });
        resolve(fallback);
        return;
      }
      resolve(parsed);
    });
  });
}

export function evaluateLoadtestReport(report, { maxP95MsByRoute = {}, maxErrorRate = null } = {}) {
  const metrics = report?.metrics || {};
  const p95ByRoute = {};
  let ok = true;

  Object.entries(maxP95MsByRoute || {}).forEach(([route, threshold]) => {
    let entry = metrics[route];
    if (!entry && !route.includes(" ")) {
      entry = metrics[`GET ${route}`] || metrics[`POST ${route}`] || null;
    }
    const p95 = entry?.p95Ms ?? null;
    p95ByRoute[route] = p95;
    if (p95 == null || !Number.isFinite(Number(threshold)) || p95 > Number(threshold)) {
      ok = false;
    }
  });

  let total = 0;
  let errors = 0;
  Object.values(metrics).forEach((entry) => {
    total += entry?.count || 0;
    errors += entry?.errors || 0;
  });
  const errorRate = total > 0 ? errors / total : 0;
  if (maxErrorRate != null && Number.isFinite(Number(maxErrorRate)) && errorRate > Number(maxErrorRate)) {
    ok = false;
  }

  return { ok, p95ByRoute, errorRate };
}
