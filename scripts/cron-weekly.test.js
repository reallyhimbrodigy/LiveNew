import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-cron-weekly-"));
const res = spawnSync(process.execPath, ["scripts/cron-weekly.js"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir },
  encoding: "utf8",
});

assert(res.status === 2, "cron-weekly should exit 2 when BASE_URL missing");
const latestPath = path.join(tmpDir, "weekly", "latest.json");
const latest = await fs.readFile(latestPath, "utf8");
assert(latest.length > 0, "cron-weekly should write latest.json on failure");

console.log(JSON.stringify({ ok: true }));
