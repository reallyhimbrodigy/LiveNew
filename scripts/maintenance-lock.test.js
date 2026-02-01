import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-maint-lock-"));
const maintDir = path.join(tmpDir, "maintenance");
await fs.mkdir(maintDir, { recursive: true });
await fs.writeFile(path.join(maintDir, "maintenance-ok.json"), JSON.stringify({ ok: true }));

const lockRes = spawnSync(process.execPath, ["scripts/first-clean-maintenance-lock.js"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, RETENTION_DAYS: "90", IDEMPOTENCY_RETENTION_DAYS: "30" },
  encoding: "utf8",
});
assert(lockRes.status === 0, "first-clean-maintenance-lock should exit 0");

const mismatchRes = spawnSync(process.execPath, ["scripts/maintenance-gate.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ARTIFACTS_DIR: tmpDir,
    RETENTION_DAYS: "120",
    IDEMPOTENCY_RETENTION_DAYS: "30",
    MAINTENANCE_GATE_MOCK: "ok",
  },
  encoding: "utf8",
});

assert(mismatchRes.status === 2, "maintenance-gate should block retention changes without evidence");
console.log(JSON.stringify({ ok: true }));
