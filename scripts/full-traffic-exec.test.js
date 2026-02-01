import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-full-traffic-exec-"));
const envFile = path.join(tmpDir, "env.production");
await fs.writeFile(envFile, "BASE_URL=http://127.0.0.1:3000\n");

const res = spawnSync(process.execPath, ["scripts/full-traffic-exec.js", "--env-file", envFile], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, FULL_TRAFFIC_EXEC_SKIP_RUN: "true" },
  encoding: "utf8",
});

assert(res.status === 2, "full-traffic-exec should fail when canary-off artifact is missing");
console.log(JSON.stringify({ ok: true }));
