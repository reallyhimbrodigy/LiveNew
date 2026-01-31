import { spawnSync } from "child_process";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const missingLocks = spawnSync(process.execPath, ["scripts/launch-finalize.js"], {
  cwd: process.cwd(),
  env: { ...process.env, CANARY_ALLOWLIST: "" },
  encoding: "utf8",
});
assert(missingLocks.status !== 0, "launch-finalize should fail when locks missing");

const canarySet = spawnSync(process.execPath, ["scripts/launch-finalize.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FREEZE_LIB_VERSION: "true",
    EXPECTED_LIB_VERSION: String(LIB_VERSION),
    CONTRACT_LOCK: "true",
    DOMAIN_LOCK: "true",
    STATIC_ROOT_LOCK: "true",
    EXPECTED_STATIC_ROOT: "public",
    CANARY_ALLOWLIST: "user@example.com",
  },
  encoding: "utf8",
});
assert(canarySet.status !== 0, "launch-finalize should fail when canary allowlist set");

console.log(JSON.stringify({ ok: true }));
