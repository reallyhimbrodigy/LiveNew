import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-maint-until-"));
const res = spawnSync(process.execPath, ["scripts/maintenance-until-clean.js", "--maintenance-gate"], {
  cwd: process.cwd(),
  env: { ...process.env, MAINTENANCE_GATE_MOCK: "ok", ARTIFACTS_DIR: tmpDir },
  encoding: "utf8",
});

assert(res.status === 0, "maintenance-until-clean should pass when maintenance-gate ok");
const lockPath = path.join(tmpDir, "maintenance", "retention-locked.json");
const lockExists = await fs
  .stat(lockPath)
  .then(() => true)
  .catch(() => false);
assert(lockExists, "maintenance-until-clean should create retention lock");

console.log(JSON.stringify({ ok: true }));
