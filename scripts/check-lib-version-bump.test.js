import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const failRes = spawnSync(process.execPath, ["scripts/check-lib-version-bump.js"], {
  cwd: process.cwd(),
  env: { ...process.env, LIB_VERSION_DIFF_FILES: "src/domain/libraries/foo.js" },
  encoding: "utf8",
});
assert(failRes.status !== 0, "check-lib-version-bump should fail when library changes without version bump");

const okRes = spawnSync(process.execPath, ["scripts/check-lib-version-bump.js"], {
  cwd: process.cwd(),
  env: { ...process.env, LIB_VERSION_DIFF_FILES: "src/domain/libraries/foo.js,src/domain/libraryVersion.js" },
  encoding: "utf8",
});
assert(okRes.status === 0, "check-lib-version-bump should pass when version file changed");

console.log(JSON.stringify({ ok: true }));
