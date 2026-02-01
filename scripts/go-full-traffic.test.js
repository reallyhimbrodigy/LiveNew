import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-full-traffic-"));
const envFile = path.join(tmpDir, "env.production");
await fs.writeFile(
  envFile,
  [
    "SIM_AUTH_TOKEN=token",
    "EXPECTED_LIB_VERSION=1",
    "FREEZE_LIB_VERSION=true",
    "CONTRACT_LOCK=true",
    "DOMAIN_LOCK=true",
    "STATIC_ROOT_LOCK=true",
  ].join("\n")
);

const res = spawnSync(process.execPath, ["scripts/go-full-traffic.js", "--env-file", envFile], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir },
  encoding: "utf8",
});

assert(res.status !== 0, "go-full-traffic should fail when prod gate fails");
console.log(JSON.stringify({ ok: true }));
