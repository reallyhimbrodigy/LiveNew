// Runbook: run maintenance once and ensure retention lock exists after clean pass.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { artifactsBaseDir, writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");

function hasFlag(name) {
  return process.argv.includes(name);
}

function lockPath() {
  return path.join(artifactsBaseDir(), "maintenance", "retention-locked.json");
}

function run() {
  const useGate = hasFlag("--maintenance-gate");
  const scriptName = useGate ? "maintenance-gate.js" : "cron-weekly.js";
  const result = runNode(path.join(ROOT, "scripts", scriptName), { args: ["--json"] });

  if (!result.ok) {
    const artifactPath = writeArtifact("maintenance", "until-clean", {
      ok: false,
      ranAt: new Date().toISOString(),
      step: scriptName,
      exitCode: result.code ?? 1,
      instructions: ["Review maintenance outputs", "Resolve failures and re-run maintenance-until-clean"],
    });
    const out = { ok: false, artifactPath };
    console.log(USE_JSON ? JSON.stringify(out) : `maintenance_until_clean ok=false artifact=${artifactPath}`);
    process.exit(result.code ?? 1);
  }

  const lock = lockPath();
  if (!fs.existsSync(lock)) {
    const lockResult = runNode(path.join(ROOT, "scripts", "first-clean-maintenance-lock.js"), { args: ["--json"] });
    if (!fs.existsSync(lock)) {
      const artifactPath = writeArtifact("maintenance", "until-clean", {
        ok: false,
        ranAt: new Date().toISOString(),
        step: "first_clean_lock",
        exitCode: lockResult.code ?? 1,
      });
      const out = { ok: false, artifactPath };
      console.log(USE_JSON ? JSON.stringify(out) : `maintenance_until_clean ok=false artifact=${artifactPath}`);
      process.exit(lockResult.code ?? 1);
    }
  }

  const artifactPath = writeArtifact("maintenance", "until-clean", {
    ok: true,
    ranAt: new Date().toISOString(),
    lockPath: lock,
  });
  const out = { ok: true, artifactPath };
  console.log(USE_JSON ? JSON.stringify(out) : `maintenance_until_clean ok=true artifact=${artifactPath}`);
}

run();
