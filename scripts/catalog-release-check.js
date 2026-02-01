// Runbook: enforce controlled catalog releases during freeze windows.
import path from "path";
import fs from "fs";
import { runNode } from "./lib/exec.js";
import { isCanaryEnabled } from "./lib/canary.js";
import { artifactsBaseDir } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict") || process.env.STRICT === "true";
const STABILITY_N_RAW = Number(process.env.CATALOG_STABILITY_N || 3);
const STABILITY_N = Number.isFinite(STABILITY_N_RAW) ? Math.max(1, STABILITY_N_RAW) : 3;
const INCIDENT_LOOKBACK_HOURS_RAW = Number(process.env.CATALOG_INCIDENT_LOOKBACK_HOURS || 72);
const INCIDENT_LOOKBACK_HOURS = Number.isFinite(INCIDENT_LOOKBACK_HOURS_RAW) ? Math.max(1, INCIDENT_LOOKBACK_HOURS_RAW) : 72;

function parseThreshold(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed > 1 ? parsed / 100 : parsed;
}

const PARITY_THRESHOLDS = {
  checkin: parseThreshold(process.env.CHECKIN_IDEMPOTENCY_MA_RATE, 0.98),
  quick: parseThreshold(process.env.QUICK_IDEMPOTENCY_MA_RATE, 0.98),
  today: parseThreshold(process.env.TODAY_IF_NONE_MATCH_MA_RATE, 0.9),
};

function listArtifacts(subdir) {
  const dir = path.join(artifactsBaseDir(), subdir);
  try {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    return files.map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function listRecentIncidents(subdir, lookbackMs) {
  const dir = path.join(artifactsBaseDir(), subdir);
  try {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    const cutoff = Date.now() - lookbackMs;
    return files
      .map((name) => {
        const filePath = path.join(dir, name);
        try {
          const stat = fs.statSync(filePath);
          return stat.mtimeMs >= cutoff ? filePath : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function latestArtifacts(paths, count) {
  const entries = paths
    .map((filePath) => {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const stat = fs.statSync(filePath);
        return { filePath, parsed, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.slice(0, count);
}

function parityOk(artifact) {
  const parity = artifact?.parity;
  const moving = parity?.movingAverage || null;
  if (!moving) return false;
  return (
    Number(moving.checkin) >= PARITY_THRESHOLDS.checkin &&
    Number(moving.quick) >= PARITY_THRESHOLDS.quick &&
    Number(moving.today) >= PARITY_THRESHOLDS.today
  );
}

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `catalog_release ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function outputAndExit(summary, code) {
  console.log(USE_JSON ? JSON.stringify(summary) : summarizeLine(summary));
  process.exit(code);
}

function run() {
  const missing = [];
  if (process.env.CATALOG_RELEASE_MODE !== "true") missing.push("CATALOG_RELEASE_MODE");
  if (process.env.CATALOG_FREEZE !== "true") missing.push("CATALOG_FREEZE");
  if (process.env.CANARY_MODE !== "true") missing.push("CANARY_MODE");
  if (missing.length) {
    outputAndExit({ ok: false, error: "catalog_release_mode_required", missing }, 2);
  }
  if (!isCanaryEnabled()) {
    outputAndExit({ ok: false, error: "canary_allowlist_required" }, 2);
  }

  const nightly = latestArtifacts(listArtifacts("nightly"), STABILITY_N);
  if (nightly.length < STABILITY_N || nightly.some((entry) => entry.parsed?.ok !== true)) {
    outputAndExit(
      {
        ok: false,
        error: "stability_nightly_failed",
        required: STABILITY_N,
        found: nightly.length,
      },
      1
    );
  }

  const daily = latestArtifacts(listArtifacts("daily"), STABILITY_N);
  if (daily.length < STABILITY_N || daily.some((entry) => !parityOk(entry.parsed))) {
    outputAndExit(
      {
        ok: false,
        error: "stability_parity_failed",
        required: STABILITY_N,
        found: daily.length,
        thresholds: PARITY_THRESHOLDS,
      },
      1
    );
  }

  const lookbackMs = INCIDENT_LOOKBACK_HOURS * 60 * 60 * 1000;
  const recentParity = listRecentIncidents("incidents/parity", lookbackMs);
  const recentPerf = listRecentIncidents("incidents/perf", lookbackMs);
  if (recentParity.length || recentPerf.length) {
    outputAndExit(
      {
        ok: false,
        error: "recent_incidents_present",
        lookbackHours: INCIDENT_LOOKBACK_HOURS,
        parity: recentParity,
        perf: recentPerf,
      },
      1
    );
  }

  const results = [];
  results.push({
    step: "operate_mode_check",
    ...runNode(path.join(ROOT, "scripts", "operate-mode-check.js"), { env: { CATALOG_RELEASE_INTENT: "true" } }),
  });
  if (!results[0].ok) {
    outputAndExit({ ok: false, steps: results }, results[0].code === 2 ? 2 : 1);
  }

  const libCheck = runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"), { args: STRICT ? ["--strict"] : [] });
  results.push({ step: "lib_version_bump", ...libCheck });
  results.push({ step: "catalog_coverage", ...runNode(path.join(ROOT, "scripts", "constraints.coverage.test.js")) });

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
    stability: {
      required: STABILITY_N,
      nightly: nightly.map((entry) => ({ path: entry.filePath, ok: entry.parsed?.ok === true })),
      parity: daily.map((entry) => ({ path: entry.filePath, ok: parityOk(entry.parsed) })),
      thresholds: PARITY_THRESHOLDS,
      incidentLookbackHours: INCIDENT_LOOKBACK_HOURS,
    },
    rollout: {
      canaryMode: true,
      requiredSteps: ["set CANARY_ALLOWLIST", "run full-traffic gate", "monitor parity/perf"],
    },
  };

  outputAndExit(summary, ok ? 0 : 1);
}

run();
