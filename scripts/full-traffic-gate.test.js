import { spawnSync } from "child_process";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const res = spawnSync(process.execPath, ["scripts/full-traffic-gate.js"], {
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
assert(res.status !== 0, "full-traffic-gate should fail when canary allowlist is set");

const missingLocks = spawnSync(process.execPath, ["scripts/full-traffic-gate.js"], {
  cwd: process.cwd(),
  env: { ...process.env, CANARY_ALLOWLIST: "" },
  encoding: "utf8",
});
assert(missingLocks.status === 2, "full-traffic-gate should exit 2 when locks are missing");

console.log(JSON.stringify({ ok: true }));
