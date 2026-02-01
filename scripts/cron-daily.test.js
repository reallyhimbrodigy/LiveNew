import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-cron-daily-"));
const parityPath = path.join(tmpDir, "parity.log");
await fs.writeFile(
  parityPath,
  `${JSON.stringify({
    event: "client_parity",
    checkin: { pctWithKey: 99 },
    quick: { pctWithKey: 99 },
    today: { pctIfNoneMatch: 95 },
  })}\n`
);

const res = spawnSync(process.execPath, ["scripts/cron-daily.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PARITY_LOG_PATH: parityPath, ARTIFACTS_DIR: tmpDir },
  encoding: "utf8",
});

assert(res.status === 0, "cron-daily should exit 0");
const latestPath = path.join(tmpDir, "daily", "latest.json");
const latest = await fs.readFile(latestPath, "utf8");
assert(latest.length > 0, "cron-daily should write latest.json");

console.log(JSON.stringify({ ok: true }));
