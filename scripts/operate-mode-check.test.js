import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const failRes = spawnSync(process.execPath, ["scripts/operate-mode-check.js"], {
  cwd: process.cwd(),
  env: { ...process.env, LAUNCH_WINDOW: "true" },
  encoding: "utf8",
});
assert(failRes.status === 2, "operate-mode-check should exit 2 when locks missing in launch window");

const okRes = spawnSync(process.execPath, ["scripts/operate-mode-check.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LAUNCH_WINDOW: "true",
    FREEZE_LIB_VERSION: "true",
    CONTRACT_LOCK: "true",
    DOMAIN_LOCK: "true",
    STATIC_ROOT_LOCK: "true",
    CATALOG_FREEZE: "true",
    REQUIRED_EVIDENCE_ID: "EV123",
    OVERRIDE_REASON: "incident-123",
  },
  encoding: "utf8",
});
assert(okRes.status === 0, "operate-mode-check should pass with locks and evidence");

console.log(JSON.stringify({ ok: true }));
