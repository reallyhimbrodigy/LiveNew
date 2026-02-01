import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-full-traffic-mismatch-"));
const envFile = path.join(tmpDir, "env.production");
await fs.writeFile(envFile, "BASE_URL=http://127.0.0.1:3000\n");

const mockGate = JSON.stringify({ ok: true, code: 0, gate: { canary_enabled: true } });
const res = spawnSync(process.execPath, ["scripts/go-full-traffic.js", "--env-file", envFile], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, GO_FULL_TRAFFIC_GATE_JSON: mockGate },
  encoding: "utf8",
});

assert(res.status === 2, "go-full-traffic should fail when gate reports canary enabled");
console.log(JSON.stringify({ ok: true }));
