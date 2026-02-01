import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-cron-nightly-"));
const res = spawnSync(process.execPath, ["scripts/cron-nightly.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SIM_BASE_URL: "http://127.0.0.1:3000",
    SIM_AUTH_TOKEN: "token",
    SKIP_NIGHTLY_CANARY: "true",
    PERF_GATE_MOCK: "true",
    PERF_GATE_LOAD_OK: "true",
    PERF_GATE_DB_OK: "true",
    ARTIFACTS_DIR: tmpDir,
  },
  encoding: "utf8",
});

assert(res.status === 0, "cron-nightly should exit 0");
const latestPath = path.join(tmpDir, "nightly", "latest.json");
const latest = await fs.readFile(latestPath, "utf8");
assert(latest.length > 0, "cron-nightly should write latest.json");

console.log(JSON.stringify({ ok: true }));
