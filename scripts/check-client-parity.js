// Runbook: set PARITY_LOG_PATH (preferred) or LOG_PATHS to server logs with client_parity events.
import fs from "fs";
import fsSync from "fs";
import { writeArtifact } from "./lib/artifacts.js";
import { writeEvidenceBundle } from "./lib/evidence-bundle.js";

const PARITY_LOG_PATH = (process.env.PARITY_LOG_PATH || "").trim();
const PARITY_REPORT_PATH = (process.env.PARITY_REPORT_PATH || process.env.PARITY_OUTPUT_PATH || "").trim();
const PARITY_MOVING_WINDOW_RAW = Number(process.env.PARITY_MOVING_WINDOW || 20);
const PARITY_MOVING_WINDOW = Number.isFinite(PARITY_MOVING_WINDOW_RAW) ? Math.max(1, PARITY_MOVING_WINDOW_RAW) : 20;
const PARITY_TAIL_LINES_RAW = Number(process.env.PARITY_TAIL_LINES || PARITY_MOVING_WINDOW);
const PARITY_TAIL_LINES = Number.isFinite(PARITY_TAIL_LINES_RAW)
  ? Math.max(PARITY_MOVING_WINDOW, PARITY_TAIL_LINES_RAW)
  : PARITY_MOVING_WINDOW;
const PARITY_TREND_DROP_RAW = Number(process.env.PARITY_TREND_DROP || 0.05);
const PARITY_TREND_DROP = Number.isFinite(PARITY_TREND_DROP_RAW) && PARITY_TREND_DROP_RAW > 0 ? PARITY_TREND_DROP_RAW : 0.05;
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

const THRESHOLDS_LATEST = {
  checkin: thresholdFrom("CHECKIN_IDEMPOTENCY_RATE", "CHECKIN_IDEMPOTENCY_MIN", 0.98),
  quick: thresholdFrom("QUICK_IDEMPOTENCY_RATE", "QUICK_IDEMPOTENCY_MIN", 0.98),
  today: thresholdFrom("TODAY_IF_NONE_MATCH_RATE", "TODAY_ETAG_MIN", 0.9),
};

const THRESHOLDS_MA = {
  checkin: thresholdFrom("CHECKIN_IDEMPOTENCY_MA_RATE", "CHECKIN_IDEMPOTENCY_RATE", 0.98),
  quick: thresholdFrom("QUICK_IDEMPOTENCY_MA_RATE", "QUICK_IDEMPOTENCY_RATE", 0.98),
  today: thresholdFrom("TODAY_IF_NONE_MATCH_MA_RATE", "TODAY_IF_NONE_MATCH_RATE", 0.9),
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

function readParityEvents(filePath) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  const start = Math.max(0, lines.length - PARITY_TAIL_LINES);
  const events = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.event === "client_parity") events.push(parsed);
    } catch {
      // ignore
    }
  }
  return events;
}

async function findLatestParity(paths) {
  const entries = [];
  for (const entry of paths) {
    if (!entry) continue;
    if (!fsSync.existsSync(entry)) continue;
    const events = readParityEvents(entry);
    if (!events.length) continue;
    let stat = null;
    try {
      stat = fs.statSync(entry);
    } catch {
      stat = null;
    }
    entries.push({ path: entry, events, mtimeMs: stat?.mtimeMs || 0 });
  }
  if (!entries.length) return null;
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0];
}

function ratesFrom(event) {
  return {
    checkin: ratioFrom(event.checkin, "pctWithKey", "withKey", "total"),
    quick: ratioFrom(event.quick, "pctWithKey", "withKey", "total"),
    today: ratioFrom(event.today, "pctIfNoneMatch", "withIfNoneMatch", "total"),
  };
}

function averageRates(events) {
  const sums = { checkin: 0, quick: 0, today: 0 };
  const counts = { checkin: 0, quick: 0, today: 0 };
  events.forEach((event) => {
    const rates = ratesFrom(event);
    Object.keys(rates).forEach((key) => {
      const value = rates[key];
      if (value == null) return;
      sums[key] += value;
      counts[key] += 1;
    });
  });
  const avg = {};
  Object.keys(sums).forEach((key) => {
    avg[key] = counts[key] ? sums[key] / counts[key] : null;
  });
  return avg;
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
  const events = latest.events || [];
  const latestEvent = events[events.length - 1] || {};
  const actual = ratesFrom(latestEvent);
  const windowStart = Math.max(0, events.length - PARITY_MOVING_WINDOW);
  const currentWindow = events.slice(windowStart);
  const previousWindow = events.slice(Math.max(0, windowStart - PARITY_MOVING_WINDOW), windowStart);
  const movingAverage = averageRates(currentWindow);
  const previousAverage = previousWindow.length ? averageRates(previousWindow) : null;
  const trendDrop = {};
  if (previousAverage) {
    Object.keys(movingAverage).forEach((key) => {
      const prev = previousAverage[key];
      const curr = movingAverage[key];
      if (prev == null || curr == null) return;
      trendDrop[key] = prev - curr;
    });
  }

  const missing = [];
  const failures = [];
  Object.entries(THRESHOLDS_LATEST).forEach(([key, threshold]) => {
    const value = actual[key];
    if (value == null) {
      missing.push(`${key}_latest`);
      return;
    }
    if (value < threshold) {
      failures.push({ metric: key, value, threshold, reason: "latest_below_threshold" });
    }
  });
  Object.entries(THRESHOLDS_MA).forEach(([key, threshold]) => {
    const value = movingAverage[key];
    if (value == null) {
      missing.push(`${key}_moving_average`);
      return;
    }
    if (value < threshold) {
      failures.push({ metric: key, value, threshold, reason: "moving_average_below_threshold" });
    }
  });
  Object.entries(trendDrop).forEach(([key, drop]) => {
    if (drop > PARITY_TREND_DROP) {
      failures.push({ metric: key, drop, threshold: PARITY_TREND_DROP, reason: "trend_drop" });
    }
  });

  const ok = missing.length === 0 && failures.length === 0;
  const summary = {
    ok,
    source: latest.path,
    thresholds: { latest: THRESHOLDS_LATEST, movingAverage: THRESHOLDS_MA },
    actual,
    movingAverage,
    previousAverage,
    trendDrop,
    missing,
    failures,
  };

  const useJson = process.argv.includes("--json");
  if (useJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(summarizeLine(summary));
  }
  if (!ok) {
    const artifactPath = writeArtifact("incidents/parity", "parity", summary);
    writeEvidenceBundle({
      evidenceId: (process.env.REQUIRED_EVIDENCE_ID || "").trim(),
      type: "parity",
      requestId: (process.env.REQUEST_ID || "").trim(),
      scenarioPack: (process.env.SCENARIO_PACK || "").trim(),
      extra: { artifactPath, thresholds: summary.thresholds, movingAverage, trendDrop },
    });
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
