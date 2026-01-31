// Runbook: set PARITY_LOG_PATH (preferred) or LOG_PATHS to server logs with client_parity events.
import fs from "fs/promises";
import fsSync from "fs";

const PARITY_LOG_PATH = (process.env.PARITY_LOG_PATH || "").trim();
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

const THRESHOLDS = {
  checkin: parseThreshold(process.env.CHECKIN_IDEMPOTENCY_MIN, 0.98),
  quick: parseThreshold(process.env.QUICK_IDEMPOTENCY_MIN, 0.98),
  today: parseThreshold(process.env.TODAY_ETAG_MIN, 0.9),
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
  for (let i = lines.length - 1; i >= 0; i -= 1) {
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

async function run() {
  const sources = PARITY_LOG_PATH ? [PARITY_LOG_PATH] : LOG_PATHS;
  if (!sources.length) {
    console.error(JSON.stringify({ ok: false, error: "missing_parity_logs", message: "Set PARITY_LOG_PATH or LOG_PATHS" }));
    process.exit(1);
  }

  const latest = await findLatestParity(sources);
  if (!latest) {
    console.error(JSON.stringify({ ok: false, error: "missing_parity_data" }));
    process.exit(1);
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

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
