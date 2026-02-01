// Runbook: scheduling-friendly wrapper for run-weekly.
import fs from "fs";
import path from "path";
import { runNode } from "./lib/exec.js";
import { artifactsBaseDir, ensureDir } from "./lib/artifacts.js";

const ROOT = process.cwd();

function run() {
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
