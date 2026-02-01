import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-postdeploy-perf-"));
const res = spawnSync(process.execPath, ["scripts/post-deploy-perf.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PERF_GATE_MOCK: "true",
    PERF_GATE_LOAD_OK: "false",
    PERF_GATE_DB_OK: "true",
    ARTIFACTS_DIR: tmpDir,
  },
  encoding: "utf8",
});

assert(res.status !== 0, "post-deploy-perf should fail when perf-gate fails");
const incidents = await fs.readdir(path.join(tmpDir, "incidents", "perf"));
assert(incidents.some((name) => name.includes("postdeploy")), "post-deploy-perf should write postdeploy incident");

console.log(JSON.stringify({ ok: true }));
