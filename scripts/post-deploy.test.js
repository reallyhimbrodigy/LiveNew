import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-post-deploy-"));
const res = spawnSync(process.execPath, ["scripts/post-deploy.js"], {
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

assert(res.status !== 0, "post-deploy should fail when post-deploy-perf fails");
const deployArtifacts = await fs.readdir(path.join(tmpDir, "deploy"));
assert(deployArtifacts.length > 0, "post-deploy should write deploy artifact");

console.log(JSON.stringify({ ok: true }));
