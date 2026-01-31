import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-nightly-"));
const res = spawnSync(process.execPath, ["scripts/run-nightly.js", "--json"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SIM_BASE_URL: "http://127.0.0.1:3000",
    SKIP_NIGHTLY_CANARY: "true",
    PERF_GATE_MOCK: "true",
    PERF_GATE_LOAD_OK: "false",
    PERF_GATE_DB_OK: "true",
    ARTIFACTS_DIR: artifactDir,
  },
  encoding: "utf8",
});

assert(res.status === 1, "run-nightly should fail when perf-gate fails");
console.log(JSON.stringify({ ok: true }));
