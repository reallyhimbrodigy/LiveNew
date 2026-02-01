import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-proof-missing-"));
const res = spawnSync(process.execPath, ["scripts/prove-stability-window.js", "--mode", "full", "--json"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir, PROVE_SKIP_RUN: "true" },
  encoding: "utf8",
});

assert(res.status === 1, "proof should fail when full-traffic artifact missing");
console.log(JSON.stringify({ ok: true }));
