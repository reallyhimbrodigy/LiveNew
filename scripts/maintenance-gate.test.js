import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const failRes = spawnSync(process.execPath, ["scripts/maintenance-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, MAINTENANCE_GATE_MOCK: "fail" },
  encoding: "utf8",
});
assert(failRes.status !== 0, "maintenance-gate should fail when mocked fail");

const okRes = spawnSync(process.execPath, ["scripts/maintenance-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, MAINTENANCE_GATE_MOCK: "ok" },
  encoding: "utf8",
});
assert(okRes.status === 0, "maintenance-gate should pass when mocked ok");

console.log(JSON.stringify({ ok: true }));
