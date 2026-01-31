import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const failRes = spawnSync(process.execPath, ["scripts/require-evidence.js"], {
  cwd: process.cwd(),
  env: { ...process.env, LAUNCH_WINDOW: "true", OVERRIDE_REASON: "manual", OVERRIDE_FLAG: "true" },
  encoding: "utf8",
});
assert(failRes.status === 2, "require-evidence should exit 2 without REQUIRED_EVIDENCE_ID");

const okRes = spawnSync(process.execPath, ["scripts/require-evidence.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LAUNCH_WINDOW: "true",
    OVERRIDE_REASON: "manual",
    REQUIRED_EVIDENCE_ID: "EV123",
    OVERRIDE_FLAG: "true",
  },
  encoding: "utf8",
});
assert(okRes.status === 0, "require-evidence should pass with evidence and override reason");

console.log(JSON.stringify({ ok: true }));
