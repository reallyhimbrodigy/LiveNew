import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-proof-latest-"));
const stabilityDir = path.join(tmpDir, "stability");
const dailyDir = path.join(tmpDir, "daily");
await fs.mkdir(stabilityDir, { recursive: true });
await fs.mkdir(dailyDir, { recursive: true });

const stabilityPath = path.join(stabilityDir, "stability-daily.json");
const latestPath = path.join(dailyDir, "latest.json");
await fs.writeFile(stabilityPath, JSON.stringify({ ok: true, exitCode: 0 }));
await fs.writeFile(latestPath, JSON.stringify({ ok: true }));

const oldTime = new Date(Date.now() - 60_000);
await fs.utimes(latestPath, oldTime, oldTime);

const res = spawnSync(process.execPath, ["scripts/prove-stability-window.js", "--mode", "daily", "--json"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, STABILITY_WINDOW: "true", PROVE_SKIP_RUN: "true" },
  encoding: "utf8",
});

assert(res.status === 1, "proof should fail when latest.json not updated");
console.log(JSON.stringify({ ok: true }));
