import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-perf-artifacts-"));
const failRes = spawnSync(process.execPath, ["scripts/perf-gate.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PERF_GATE_MOCK: "true",
    PERF_GATE_LOAD_OK: "false",
    PERF_GATE_DB_OK: "true",
    ARTIFACTS_DIR: artifactDir,
    PERF_PRESET: "prod",
  },
  encoding: "utf8",
});
assert(failRes.status !== 0, "perf-gate should fail when load test fails");
const perfArtifacts = await fs.readdir(path.join(artifactDir, "incidents", "perf"));
assert(perfArtifacts.length > 0, "perf-gate should write an artifact on failure");
const parsedFail = JSON.parse(failRes.stdout || "{}");
assert(parsedFail.preset === "prod", "perf-gate should surface perf preset in output");

const okRes = spawnSync(process.execPath, ["scripts/perf-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PERF_GATE_MOCK: "true", PERF_GATE_LOAD_OK: "true", PERF_GATE_DB_OK: "true" },
  encoding: "utf8",
});
assert(okRes.status === 0, "perf-gate should pass when mock ok");

console.log(JSON.stringify({ ok: true }));
