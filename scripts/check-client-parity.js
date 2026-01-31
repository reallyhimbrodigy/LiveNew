// Runbook: set PARITY_LOG_PATH (preferred) or LOG_PATHS to server logs with client_parity events.
import fs from "fs/promises";
import fsSync from "fs";

const PARITY_LOG_PATH = (process.env.PARITY_LOG_PATH || "").trim();
const PARITY_REPORT_PATH = (process.env.PARITY_REPORT_PATH || process.env.PARITY_OUTPUT_PATH || "").trim();
const PARITY_TAIL_LINES_RAW = Number(process.env.PARITY_TAIL_LINES || 2000);
const PARITY_TAIL_LINES = Number.isFinite(PARITY_TAIL_LINES_RAW) ? Math.max(1, PARITY_TAIL_LINES_RAW) : 2000;
const LOG_PATHS = (process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function parseThreshold(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
}

function thresholdFrom(envKey, fallbackKey, fallbackValue) {
  const primary = parseThreshold(process.env[envKey], null);
  if (primary != null) return primary;
  return parseThreshold(process.env[fallbackKey], fallbackValue);
}

const THRESHOLDS = {
  checkin: thresholdFrom("CHECKIN_IDEMPOTENCY_RATE", "CHECKIN_IDEMPOTENCY_MIN", 0.98),
  quick: thresholdFrom("QUICK_IDEMPOTENCY_RATE", "QUICK_IDEMPOTENCY_MIN", 0.98),
  today: thresholdFrom("TODAY_IF_NONE_MATCH_RATE", "TODAY_ETAG_MIN", 0.9),
};

function normalizeRatio(value) {
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  if (!Number.isFinite(normalized)) return null;
  return Math.max(0, Math.min(1, normalized));
}

function ratioFrom(section, pctKey, numeratorKey, denominatorKey) {
  if (!section || typeof section !== "object") return null;
  const pctRaw = section[pctKey];
  const pctValue = pctRaw == null ? null : normalizeRatio(Number(pctRaw));
  if (pctValue != null) return pctValue;
  const numerator = Number(section[numeratorKey]);
  const denominator = Number(section[denominatorKey]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return normalizeRatio(numerator / denominator);
}

async function readLatestParity(filePath) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  const start = Math.max(0, lines.length - PARITY_TAIL_LINES);
  for (let i = lines.length - 1; i >= start; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.event === "client_parity") return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

async function findLatestParity(paths) {
  const entries = [];
  for (const entry of paths) {
    if (!entry) continue;
    if (!fsSync.existsSync(entry)) continue;
    const parity = await readLatestParity(entry);
    if (!parity) continue;
    let stat = null;
    try {
      stat = await fs.stat(entry);
    } catch {
      stat = null;
    }
    entries.push({ path: entry, parity, mtimeMs: stat?.mtimeMs || 0 });
  }
  if (!entries.length) return null;
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0];
}

function summarizeLine(summary) {
  const parts = [
    `client_parity ok=${summary.ok}`,
    `source=${summary.source}`,
    `checkin=${summary.actual.checkin ?? "na"}`,
    `quick=${summary.actual.quick ?? "na"}`,
    `today=${summary.actual.today ?? "na"}`,
  ];
  return parts.join(" ");
}

async function run() {
  const sources = PARITY_LOG_PATH ? [PARITY_LOG_PATH] : PARITY_REPORT_PATH ? [PARITY_REPORT_PATH] : LOG_PATHS;
  if (!sources.length) {
    console.error(JSON.stringify({ ok: false, error: "missing_parity_logs", message: "Set PARITY_LOG_PATH or LOG_PATHS" }));
    process.exit(2);
  }

  const latest = await findLatestParity(sources);
  if (!latest) {
    console.error(JSON.stringify({ ok: false, error: "missing_parity_data" }));
    process.exit(2);
  }

  const parity = latest.parity || {};
  const actual = {
    checkin: ratioFrom(parity.checkin, "pctWithKey", "withKey", "total"),
    quick: ratioFrom(parity.quick, "pctWithKey", "withKey", "total"),
    today: ratioFrom(parity.today, "pctIfNoneMatch", "withIfNoneMatch", "total"),
  };

  const missing = [];
  const failures = [];
  Object.entries(actual).forEach(([key, value]) => {
    if (value == null) {
      missing.push(key);
      return;
    }
    if (value < THRESHOLDS[key]) {
      failures.push({ metric: key, value, threshold: THRESHOLDS[key] });
    }
  });

  const ok = missing.length === 0 && failures.length === 0;
  const summary = {
    ok,
    source: latest.path,
    thresholds: THRESHOLDS,
    actual,
    missing,
    failures,
  };

  const useJson = process.argv.includes("--json");
  if (useJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(summarizeLine(summary));
  }
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
