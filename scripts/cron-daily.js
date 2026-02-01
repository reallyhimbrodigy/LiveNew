// Runbook: scheduling-friendly wrapper for run-daily.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { artifactsBaseDir, ensureDir, writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();

function run() {
  const operate = runNode(path.join(ROOT, "scripts", "operate-mode-check.js"), { args: ["--json"] });
  if (!operate.ok) {
    const artifactPath = writeArtifact("daily", "daily", {
      ok: false,
      ranAt: new Date().toISOString(),
      step: "operate_mode_check",
      exitCode: operate.code ?? 1,
      note: operate.stderr || operate.stdout || null,
    });
    const latestPath = path.join(artifactsBaseDir(), "daily", "latest.json");
    ensureDir(path.dirname(latestPath));
    fs.writeFileSync(latestPath, fs.readFileSync(artifactPath, "utf8"));
    process.exit(operate.code ?? 1);
  }

  const res = runNode(path.join(ROOT, "scripts", "run-daily.js"), { args: ["--json"] });
  const parsed = res.parsed || {};
  const artifactPath = parsed.artifactPath;
  if (artifactPath) {
    const latestPath = path.join(artifactsBaseDir(), "daily", "latest.json");
    ensureDir(path.dirname(latestPath));
    fs.writeFileSync(latestPath, fs.readFileSync(artifactPath, "utf8"));
  }
  process.exit(res.code ?? 1);
}

run();
