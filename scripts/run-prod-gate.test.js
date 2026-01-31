import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-prod-gate-"));
const envFile = path.join(tmpDir, "env.production");
const artifactsDir = path.join(tmpDir, "artifacts");

await fs.writeFile(
  envFile,
  [
    "BASE_URL=http://127.0.0.1:3000",
    "SIM_AUTH_TOKEN=token",
    `EXPECTED_LIB_VERSION=${String(LIB_VERSION)}`,
    "FREEZE_LIB_VERSION=true",
    "CONTRACT_LOCK=true",
    "DOMAIN_LOCK=true",
    "STATIC_ROOT_LOCK=true",
    "EXPECTED_STATIC_ROOT=public",
    "CATALOG_FREEZE=true",
    "CANARY_ALLOWLIST=user@example.com",
  ].join("\n")
);

const res = spawnSync(process.execPath, ["scripts/run-prod-gate.js", "--env-file", envFile, "--json"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: artifactsDir },
  encoding: "utf8",
});
assert(res.status === 2, "run-prod-gate should propagate full-traffic gate exit code");

const gateArtifacts = await fs.readdir(path.join(artifactsDir, "gates"));
assert(gateArtifacts.length > 0, "run-prod-gate should write a gates artifact");

console.log(JSON.stringify({ ok: true }));
