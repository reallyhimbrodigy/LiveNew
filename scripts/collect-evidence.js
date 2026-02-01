// Runbook: set LOG_PATHS to recent server logs and optional REPORT_PATHS for summary JSON files.
import fs from "fs/promises";

const LOG_PATHS = (process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const REPORT_PATHS = (process.env.REPORT_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushUnique(list, value) {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function addCount(map, key, inc = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + inc;
}

async function scanLogs(paths) {
  const artifacts = {
    contractInvalidRequestIds: [],
    nondeterminismRequestIds: [],
    idempotencyMissingRequestIds: [],
    writeStormRequestIds: [],
  };
  const route4xx = {};
  const route5xx = {};
  const writeStormByRoute = {};
  const writeStormRequestIdsByRoute = {};
  const counters = {};

  for (const logPath of paths) {
    let raw = "";
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split("\n").filter(Boolean);
    lines.forEach((line) => {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const event = entry?.event || "";
      if (event === "monitoring_counters") {
        const c = entry?.counts || {};
        Object.keys(c).forEach((key) => {
          counters[key] = (counters[key] || 0) + Number(c[key] || 0);
        });
        return;
      }
      if (event === "today_contract_invalid") pushUnique(artifacts.contractInvalidRequestIds, entry?.requestId);
      if (event === "nondeterminism_detected") pushUnique(artifacts.nondeterminismRequestIds, entry?.requestId);
      if (event === "idempotency_missing") pushUnique(artifacts.idempotencyMissingRequestIds, entry?.requestId);
      if (event === "write_storm") {
        pushUnique(artifacts.writeStormRequestIds, entry?.requestId);
        if (entry?.route) addCount(writeStormByRoute, entry.route);
        if (entry?.route && entry?.requestId) {
          if (!writeStormRequestIdsByRoute[entry.route]) writeStormRequestIdsByRoute[entry.route] = [];
          if (writeStormRequestIdsByRoute[entry.route].length < 10) {
            pushUnique(writeStormRequestIdsByRoute[entry.route], entry.requestId);
          }
        }
      }

      if (entry?.route && Number.isFinite(entry?.status)) {
        if (entry.status >= 500) addCount(route5xx, entry.route);
        if (entry.status >= 400 && entry.status < 500) addCount(route4xx, entry.route);
      }
    });
  }

  return { artifacts, route4xx, route5xx, counters, writeStormByRoute, writeStormRequestIdsByRoute };
}

async function scanReports(paths) {
  const reports = [];
  for (const reportPath of paths) {
    try {
      const raw = await fs.readFile(reportPath, "utf8");
      const parsed = JSON.parse(raw);
      reports.push({ path: reportPath, ok: parsed?.ok ?? null, payload: parsed });
    } catch {
      continue;
    }
  }
  return reports;
}

function topRoutes(counts, limit = 10) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([route, count]) => ({ route, count }));
}

async function run() {
  const logSummary = LOG_PATHS.length ? await scanLogs(LOG_PATHS) : { artifacts: {}, route4xx: {}, route5xx: {}, counters: {} };
  const reports = REPORT_PATHS.length ? await scanReports(REPORT_PATHS) : [];

  const output = {
    ok: true,
    artifacts: logSummary.artifacts,
    counters: logSummary.counters,
    writeStormByRoute: logSummary.writeStormByRoute,
    writeStormRequestIdsByRoute: logSummary.writeStormRequestIdsByRoute,
    topRoutes: {
      fourxx: topRoutes(logSummary.route4xx),
      fivexx: topRoutes(logSummary.route5xx),
    },
    reports: reports.map((entry) => ({ path: entry.path, ok: entry.ok })),
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
