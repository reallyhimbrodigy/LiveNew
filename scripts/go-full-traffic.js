// Runbook: execute production gate then confirm canary removal.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact } from "./lib/artifacts.js";
import { isCanaryEnabled } from "./lib/canary.js";

const ROOT = process.cwd();

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

function parseEnvFile(filePath) {
  const env = {};
  if (!filePath) return env;
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return env;
  }
  raw.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

function run() {
  const args = parseArgs(process.argv);
  const envFile = args["env-file"] || "";
  if (!envFile && !process.env.BASE_URL && !process.env.SIM_BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "missing_env_file", required: "--env-file .env.production" }));
    process.exit(2);
  }

  const fileEnv = parseEnvFile(envFile);
  const mergedEnv = { ...fileEnv, ...process.env };
  const gateArgs = ["--json"];
  if (envFile) gateArgs.push("--env-file", envFile);

  const gate = runNode(path.join(ROOT, "scripts", "run-prod-gate.js"), { env: mergedEnv, args: gateArgs });
  if (!gate.ok) {
    const artifactPath = writeArtifact("rollouts", "full-traffic", {
      ok: false,
      step: "run_prod_gate",
      exitCode: gate.code,
      gate: gate.parsed || null,
      ranAt: new Date().toISOString(),
    });
    console.log(JSON.stringify({ ok: false, error: "prod_gate_failed", artifactPath }));
    process.exit(gate.code === 2 ? 2 : 1);
  }

  const canaryEnabled = isCanaryEnabled(mergedEnv);
  if (canaryEnabled) {
    const required = 'Set CANARY_ALLOWLIST="" (or unset) before declaring full traffic';
    const artifactPath = writeArtifact("rollouts", "full-traffic", {
      ok: false,
      step: "canary_removal",
      exitCode: 2,
      required,
      ranAt: new Date().toISOString(),
      gate: gate.parsed || null,
    });
    console.log(JSON.stringify({ ok: false, error: "canary_still_enabled", required, artifactPath }));
    process.exit(2);
  }

  const artifactPath = writeArtifact("rollouts", "full-traffic", {
    ok: true,
    ranAt: new Date().toISOString(),
    gate: gate.parsed || null,
  });
  console.log(JSON.stringify({ ok: true, artifactPath }));
}

run();
