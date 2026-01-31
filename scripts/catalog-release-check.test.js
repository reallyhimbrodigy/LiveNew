import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const res = spawnSync(process.execPath, ["scripts/catalog-release-check.js", "--json"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CATALOG_FREEZE: "true",
    CATALOG_RELEASE_MODE: "true",
    CANARY_MODE: "true",
    CANARY_ALLOWLIST: "user@example.com",
    LIB_VERSION_DIFF_FILES: "src/domain/libraries/foo.js,src/domain/libraryVersion.js",
  },
  encoding: "utf8",
});

assert(res.status === 0, "catalog-release-check should pass in release mode with canary");
console.log(JSON.stringify({ ok: true }));
