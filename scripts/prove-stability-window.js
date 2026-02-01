// Runbook: proof suite for stability-window operations.
import path from "path";
import fs from "fs";
import { artifactsBaseDir } from "./lib/artifacts.js";
import { loadEnvFile, latestArtifact, readJsonSafe, updatedSince, runScript } from "./lib/proof.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");
const MODE = (() => {
  const idx = process.argv.indexOf("--mode");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "all";
})();

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[name] = value;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

function fail(step, reason, nextAction, code = 1, details = null) {
  const out = { ok: false, step, reason, nextAction, details };
  console.log(USE_JSON ? JSON.stringify(out) : `proof ok=false step=${step} reason=${reason}`);
  process.exit(code);
}

function warn(step, reason) {
  if (!USE_JSON) console.warn(`proof warning step=${step} reason=${reason}`);
}

function ensureLatestUpdated(subdir, sinceMs) {
  const latestPath = path.join(artifactsBaseDir(), subdir, "latest.json");
  if (!fs.existsSync(latestPath)) return { ok: false, error: "latest_missing", path: latestPath };
  if (!updatedSince(latestPath, sinceMs)) return { ok: false, error: "latest_not_updated", path: latestPath };
  return { ok: true, path: latestPath };
}

function checkParityEscalation() {
  const incidentsDir = path.join(artifactsBaseDir(), "incidents", "parity");
  let hasIncident = false;
  try {
    hasIncident = fs.readdirSync(incidentsDir).some((name) => name.endsWith(".json"));
  } catch {
    hasIncident = false;
  }
  if (!hasIncident) return { ok: true, skipped: true };
  const res = runScript(path.join(ROOT, "scripts", "parity-escalate.js"), { args: ["--json"] });
  if (!res.ok && STRICT) {
    return { ok: false, error: "parity_escalate_failed", code: res.code, stdout: res.stdout, stderr: res.stderr };
  }
  if (!res.ok) warn("parity_escalate", "parity incident present");
  return { ok: res.ok, skipped: false };
}

function runFull(envFile, env) {
  const startedAt = Date.now();
  if (process.env.PROVE_SKIP_RUN !== "true") {
    const args = envFile ? ["--env-file", envFile] : [];
    const res = runScript(path.join(ROOT, "scripts", "full-traffic-exec.js"), { env, args });
    if (!res.ok) {
      return { ok: false, code: res.code, error: "full_traffic_exec_failed" };
    }
  }

  const latest = latestArtifact({ subdir: "rollouts", suffix: "-full-traffic-exec.json" });
  if (!latest) return { ok: false, error: "missing_full_traffic_exec_artifact" };
  if (latest.mtimeMs < startedAt) return { ok: false, error: "full_traffic_exec_not_updated" };

  const execJson = readJsonSafe(latest.filePath);
  if (!execJson.ok) return { ok: false, error: "invalid_full_traffic_exec_artifact" };
  const verify = execJson.value?.verify;
  if (!verify || verify.ok !== true) return { ok: false, error: "canary_off_verification_failed" };
  if (verify.canaryEnabled || verify.gateCanaryEnabled) return { ok: false, error: "canary_still_enabled" };
  const gateCanary = verify.gate?.canary_enabled ?? verify.gate?.gate?.canary_enabled ?? null;
  if (gateCanary !== false) return { ok: false, error: "missing_gate_canary_flag" };
  return { ok: true, artifact: latest.filePath };
}

function runCadence(mode, env) {
  if (process.env.STABILITY_WINDOW !== "true") {
    return { ok: false, code: 2, error: "STABILITY_WINDOW_required" };
  }
  const startedAt = Date.now();
  if (process.env.PROVE_SKIP_RUN !== "true") {
    const res = runScript(path.join(ROOT, "scripts", "run-stability-window.js"), { env, args: [`--${mode}`] });
    if (!res.ok) return { ok: false, code: res.code, error: "run_stability_window_failed" };
  }

  const latest = latestArtifact({ subdir: "stability", suffix: `-${mode}.json` });
  if (!latest) return { ok: false, error: "missing_stability_artifact" };
  if (latest.mtimeMs < startedAt) return { ok: false, error: "stability_artifact_not_updated" };

  const stabilityJson = readJsonSafe(latest.filePath);
  if (!stabilityJson.ok) return { ok: false, error: "invalid_stability_artifact" };
  if (stabilityJson.value?.exitCode === 2) return { ok: false, code: 2, error: "misconfig_exit_code" };

  const latestCheck = ensureLatestUpdated(mode, startedAt);
  if (!latestCheck.ok) return { ok: false, error: latestCheck.error, path: latestCheck.path };

  if (mode === "nightly") {
    const perfIncident = latestArtifact({ subdir: "incidents/perf" });
    if (perfIncident && perfIncident.mtimeMs >= startedAt) {
      return { ok: false, error: "perf_incident_created", path: perfIncident.filePath };
    }
  }

  if (mode === "weekly") {
    const lockPath = path.join(artifactsBaseDir(), "maintenance", "retention-locked.json");
    if (!fs.existsSync(lockPath)) {
      return { ok: false, error: "retention_lock_missing", next: "run maintenance-until-clean" };
    }
  }

  if (mode === "daily" || mode === "nightly") {
    const parityCheck = checkParityEscalation();
    if (!parityCheck.ok && STRICT) return { ok: false, error: parityCheck.error || "parity_escalate_failed" };
  }

  return { ok: true, artifact: latest.filePath };
}

function run() {
  const args = parseArgs(process.argv);
  const envFile = args["env-file"] || "";
  const fileEnv = loadEnvFile(envFile);
  const mergedEnv = { ...fileEnv, ...process.env };

  const results = [];
  const modes = MODE === "all" ? ["full", "daily", "nightly", "weekly"] : [MODE];

  for (const mode of modes) {
    if (mode === "full") {
      const res = runFull(envFile, mergedEnv);
      results.push({ mode, ...res });
      if (!res.ok) break;
    } else {
      const res = runCadence(mode, mergedEnv);
      results.push({ mode, ...res });
      if (!res.ok) break;
    }
  }

  const failed = results.find((entry) => !entry.ok);
  if (failed) {
    const code = failed.code === 2 ? 2 : 1;
    const nextAction =
      failed.error === "retention_lock_missing" ? "Run maintenance-until-clean" : "Check stability artifacts and rerun proof";
    fail(failed.mode, failed.error, nextAction, code, failed);
  }

  const out = { ok: true, mode: MODE, results };
  console.log(USE_JSON ? JSON.stringify(out) : `proof ok=true mode=${MODE}`);
}

run();
