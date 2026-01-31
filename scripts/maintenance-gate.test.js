import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-maintenance-"));
const failRes = spawnSync(process.execPath, ["scripts/maintenance-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, MAINTENANCE_GATE_MOCK: "fail", ARTIFACTS_DIR: artifactDir },
  encoding: "utf8",
});
assert(failRes.status !== 0, "maintenance-gate should fail when mocked fail");

const okRes = spawnSync(process.execPath, ["scripts/maintenance-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, MAINTENANCE_GATE_MOCK: "ok", ARTIFACTS_DIR: artifactDir },
  encoding: "utf8",
});
assert(okRes.status === 0, "maintenance-gate should pass when mocked ok");
const maintenanceArtifacts = await fs.readdir(path.join(artifactDir, "maintenance"));
assert(maintenanceArtifacts.length > 0, "maintenance-gate should write artifact");

console.log(JSON.stringify({ ok: true }));
