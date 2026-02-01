// Runbook: execute full-traffic rollout validation and verify canary-off.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { artifactsBaseDir, writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");

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

function latestCanaryVerify() {
  const dir = path.join(artifactsBaseDir(), "rollouts");
  try {
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.includes("canary-off-verify") && name.endsWith(".json"))
      .map((name) => path.join(dir, name));
    const entries = files
      .map((filePath) => {
        try {
          const stat = fs.statSync(filePath);
          const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
          return { filePath, parsed, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries[0] || null;
  } catch {
    return null;
  }
}

function run() {
  const args = parseArgs(process.argv);
  const envFile = args["env-file"] || "";
  if (!envFile && !process.env.BASE_URL && !process.env.SIM_BASE_URL) {
    const out = { ok: false, error: "missing_env_file", required: "--env-file .env.production" };
    console.log(USE_JSON ? JSON.stringify(out) : "full_traffic_exec ok=false error=missing_env_file");
    process.exit(2);
  }

  const skipRun = process.env.FULL_TRAFFIC_EXEC_SKIP_RUN === "true";
  const goResult = skipRun
    ? { ok: true, code: 0, parsed: null, stdout: "", stderr: "" }
    : runNode(path.join(ROOT, "scripts", "go-full-traffic.js"), { args: envFile ? ["--env-file", envFile] : [] });

  if (!goResult.ok) {
    const artifactPath = writeArtifact("rollouts", "full-traffic-exec", {
      ok: false,
      step: "go_full_traffic",
      exitCode: goResult.code ?? 1,
      ranAt: new Date().toISOString(),
    });
    const out = { ok: false, error: "go_full_traffic_failed", artifactPath };
    console.log(USE_JSON ? JSON.stringify(out) : `full_traffic_exec ok=false artifact=${artifactPath}`);
    process.exit(goResult.code === 2 ? 2 : 1);
  }

  const verify = latestCanaryVerify();
  if (!verify) {
    const artifactPath = writeArtifact("rollouts", "full-traffic-exec", {
      ok: false,
      step: "canary_off_verify",
      error: "missing_canary_off_artifact",
      ranAt: new Date().toISOString(),
    });
    const out = { ok: false, error: "missing_canary_off_artifact", artifactPath };
    console.log(USE_JSON ? JSON.stringify(out) : `full_traffic_exec ok=false artifact=${artifactPath}`);
    process.exit(2);
  }

  if (verify.parsed?.ok !== true || verify.parsed?.gateCanaryEnabled === true || verify.parsed?.canaryEnabled === true) {
    const artifactPath = writeArtifact("rollouts", "full-traffic-exec", {
      ok: false,
      step: "canary_off_verify",
      verify: verify.parsed || null,
      ranAt: new Date().toISOString(),
    });
    const out = { ok: false, error: "canary_still_enabled", artifactPath };
    console.log(USE_JSON ? JSON.stringify(out) : `full_traffic_exec ok=false artifact=${artifactPath}`);
    process.exit(1);
  }

  const artifactPath = writeArtifact("rollouts", "full-traffic-exec", {
    ok: true,
    verify: verify.parsed || null,
    ranAt: new Date().toISOString(),
  });
  const out = { ok: true, artifactPath };
  console.log(USE_JSON ? JSON.stringify(out) : `full_traffic_exec ok=true artifact=${artifactPath}`);
}

run();
