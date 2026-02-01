import { spawnSync } from "child_process";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const res = spawnSync(process.execPath, ["scripts/full-traffic-gate.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STABILITY_WINDOW: "true",
    CATALOG_FREEZE: "true",
    FREEZE_LIB_VERSION: "true",
    EXPECTED_LIB_VERSION: String(LIB_VERSION),
    CONTRACT_LOCK: "true",
    DOMAIN_LOCK: "true",
    STATIC_ROOT_LOCK: "true",
    EXPECTED_STATIC_ROOT: "public",
    CANARY_ALLOWLIST: "",
    LIB_VERSION_DIFF_FILES: "src/domain/libraries/foo.js,src/domain/libraryVersion.js",
  },
  encoding: "utf8",
});

assert(res.status === 1, "full-traffic-gate should fail when library changes during stability window");
console.log(JSON.stringify({ ok: true }));
