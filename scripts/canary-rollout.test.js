import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function run(env, args = ["next"]) {
  const res = spawnSync(process.execPath, ["scripts/canary-rollout.js", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return res;
}

const res = run({
  CANARY_ALLOWLIST: "a@example.com",
  CANARY_ROLLOUT_CANDIDATES: "a@example.com,b@example.com",
  CANARY_BATCH_SIZE: "10",
});
assert(res.status === 0, "canary-rollout next should exit 0");
const parsed = JSON.parse(res.stdout);
assert(parsed.action === "clear_allowlist", "should recommend clearing allowlist near end");
console.log(JSON.stringify({ ok: true }));
