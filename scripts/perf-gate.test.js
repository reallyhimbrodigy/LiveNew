import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const failRes = spawnSync(process.execPath, ["scripts/perf-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PERF_GATE_MOCK: "true", PERF_GATE_LOAD_OK: "false", PERF_GATE_DB_OK: "true" },
  encoding: "utf8",
});
assert(failRes.status !== 0, "perf-gate should fail when load test fails");

const okRes = spawnSync(process.execPath, ["scripts/perf-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PERF_GATE_MOCK: "true", PERF_GATE_LOAD_OK: "true", PERF_GATE_DB_OK: "true" },
  encoding: "utf8",
});
assert(okRes.status === 0, "perf-gate should pass when mock ok");

console.log(JSON.stringify({ ok: true }));
