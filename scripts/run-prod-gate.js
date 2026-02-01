// Runbook: run canonical full-traffic gate with production env config.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact, writeLog } from "./lib/artifacts.js";

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

function validateEnv(env) {
  const missing = [];
  if (!env.BASE_URL && !env.SIM_BASE_URL) missing.push("BASE_URL");
  if (!env.SIM_AUTH_TOKEN) missing.push("SIM_AUTH_TOKEN");
  if (!env.EXPECTED_LIB_VERSION) missing.push("EXPECTED_LIB_VERSION");
  if (env.FREEZE_LIB_VERSION !== "true") missing.push("FREEZE_LIB_VERSION");
  if (env.CONTRACT_LOCK !== "true") missing.push("CONTRACT_LOCK");
  if (env.DOMAIN_LOCK !== "true") missing.push("DOMAIN_LOCK");
  if (env.STATIC_ROOT_LOCK !== "true") missing.push("STATIC_ROOT_LOCK");
  return missing;
}

function run() {
  const args = parseArgs(process.argv);
  const envFile = args["env-file"] || "";
  const useJson = Boolean(args.json);

  const fileEnv = parseEnvFile(envFile);
  const mergedEnv = { ...fileEnv, ...process.env };

  const missing = validateEnv(mergedEnv);
  if (missing.length) {
    const out = { ok: false, error: "missing_env", missing };
    console.log(useJson ? JSON.stringify(out) : `prod_gate ok=false missing=${missing.join(",")}`);
    process.exit(2);
  }

  const gate = runNode(path.join(process.cwd(), "scripts", "full-traffic-gate.js"), { env: mergedEnv, args: args.json ? ["--json"] : [] });

  const stdoutPath = writeLog("gates", "prod-gate-stdout", gate.stdout || "");
  const stderrPath = writeLog("gates", "prod-gate-stderr", gate.stderr || "");
  const artifact = {
    ok: gate.ok,
    code: gate.code,
    baseUrl: mergedEnv.BASE_URL || mergedEnv.SIM_BASE_URL || null,
    gate: gate.parsed || null,
    stdoutPath,
    stderrPath,
    ranAt: new Date().toISOString(),
  };
  const artifactPath = writeArtifact("gates", "prod", artifact);

  const summary = {
    ok: gate.ok,
    code: gate.code,
    canary_enabled: gate.parsed?.canary_enabled ?? null,
    artifactPath,
  };
  console.log(useJson ? JSON.stringify(summary) : `prod_gate ok=${summary.ok} artifact=${artifactPath}`);
  process.exit(gate.code);
}

run();
