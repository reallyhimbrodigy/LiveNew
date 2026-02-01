// Runbook: scheduling-friendly wrapper for run-weekly.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { artifactsBaseDir, ensureDir, writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();

function preflight() {
  const baseUrl = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
  const missing = [];
  if (!baseUrl) missing.push("BASE_URL");
  return { ok: missing.length === 0, missing };
}

function run() {
  const operate = runNode(path.join(ROOT, "scripts", "operate-mode-check.js"), { args: ["--json"] });
  if (!operate.ok) {
    const artifactPath = writeArtifact("weekly", "weekly", {
      ok: false,
      ranAt: new Date().toISOString(),
      step: "operate_mode_check",
      exitCode: operate.code ?? 1,
      note: operate.stderr || operate.stdout || null,
    });
    const latestPath = path.join(artifactsBaseDir(), "weekly", "latest.json");
    ensureDir(path.dirname(latestPath));
    fs.writeFileSync(latestPath, fs.readFileSync(artifactPath, "utf8"));
    process.exit(operate.code ?? 1);
  }

  const pre = preflight();
  if (!pre.ok) {
    const artifactPath = writeArtifact("weekly", "weekly", {
      ok: false,
      ranAt: new Date().toISOString(),
      step: "preflight",
      exitCode: 2,
      missing: pre.missing,
    });
    const latestPath = path.join(artifactsBaseDir(), "weekly", "latest.json");
    ensureDir(path.dirname(latestPath));
    fs.writeFileSync(latestPath, fs.readFileSync(artifactPath, "utf8"));
    process.exit(2);
  }

  const res = runNode(path.join(ROOT, "scripts", "run-weekly.js"), { args: ["--json"] });
  const parsed = res.parsed || {};
  const artifactPath = parsed.artifactPath;
  if (artifactPath) {
    const latestPath = path.join(artifactsBaseDir(), "weekly", "latest.json");
    ensureDir(path.dirname(latestPath));
    fs.writeFileSync(latestPath, fs.readFileSync(artifactPath, "utf8"));
  }
  process.exit(res.code ?? 1);
}

run();
