const ALLOWED_LABELS = new Set(["route", "status", "dateKey", "userBucket"]);
const NAME_ALIASES = {
  nondeterminism: "nondeterminism_detected",
  write_storm: "write_storm_429",
};

function normalizeName(name) {
  if (!name) return null;
  return NAME_ALIASES[name] || name;
}

function normalizeLabels(labels) {
  if (!labels || typeof labels !== "object") return null;
  const out = {};
  for (const key of Object.keys(labels)) {
    if (!ALLOWED_LABELS.has(key)) continue;
    const value = labels[key];
    if (value == null || value === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function labelsKey(name, labels) {
  const keys = Object.keys(labels).sort();
  const parts = keys.map((key) => `${key}=${labels[key]}`);
  return `${name}|${parts.join("|")}`;
}

export function createMonitoringCounters({ logFn, intervalMs }) {
  const counters = new Map();
  const labeled = new Map();
  const safeIntervalMs = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 0;
  const logger = typeof logFn === "function" ? logFn : null;

  function increment(name, labels, inc = 1) {
    const normalized = normalizeName(name);
    if (!normalized) return;
    const delta = Number(inc) || 0;
    if (!delta) return;
    counters.set(normalized, (counters.get(normalized) || 0) + delta);

    const normalizedLabels = normalizeLabels(labels);
    if (normalizedLabels) {
      const key = labelsKey(normalized, normalizedLabels);
      const existing = labeled.get(key) || { name: normalized, labels: normalizedLabels, count: 0 };
      existing.count += delta;
      labeled.set(key, existing);
    }
  }

  function flush(reason = "interval") {
    if (!counters.size || !logger) return;
    const snapshot = {};
    for (const [key, value] of counters.entries()) {
      if (value) snapshot[key] = value;
    }
    if (!Object.keys(snapshot).length) return;
    counters.clear();
    const series = Array.from(labeled.values()).filter((entry) => entry.count);
    labeled.clear();
    const payload = {
      event: "monitoring_counters",
      reason,
      windowMs: safeIntervalMs,
      counts: snapshot,
    };
    if (series.length) payload.series = series;
    logger(payload);
  }

  function start() {
    if (safeIntervalMs <= 0 || !logger) return;
    setInterval(() => flush("interval"), safeIntervalMs).unref();
  }

  return { increment, flush, start };
}
