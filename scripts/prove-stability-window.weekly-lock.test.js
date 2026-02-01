import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-proof-weekly-"));
const stabilityDir = path.join(tmpDir, "stability");
const weeklyDir = path.join(tmpDir, "weekly");
await fs.mkdir(stabilityDir, { recursive: true });
await fs.mkdir(weeklyDir, { recursive: true });

const stabilityPath = path.join(stabilityDir, "stability-weekly.json");
const latestPath = path.join(weeklyDir, "latest.json");
await fs.writeFile(stabilityPath, JSON.stringify({ ok: true, exitCode: 0 }));
await fs.writeFile(latestPath, JSON.stringify({ ok: true }));

const future = new Date(Date.now() + 60_000);
await fs.utimes(latestPath, future, future);
await fs.utimes(stabilityPath, future, future);

const res = spawnSync(process.execPath, ["scripts/prove-stability-window.js", "--mode", "weekly", "--json"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, STABILITY_WINDOW: "true", PROVE_SKIP_RUN: "true" },
  encoding: "utf8",
});

assert(res.status === 1, "proof should fail when retention lock missing");
console.log(JSON.stringify({ ok: true }));
