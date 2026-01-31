import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const logPath = path.join(process.cwd(), "data", `evidence-log-${Date.now()}.log`);
  const sample = [
    JSON.stringify({ event: "today_contract_invalid", requestId: "req-1" }),
    JSON.stringify({ event: "nondeterminism_detected", requestId: "req-2" }),
    JSON.stringify({ event: "idempotency_missing", requestId: "req-3" }),
    JSON.stringify({ event: "write_storm", requestId: "req-4" }),
    JSON.stringify({ event: "monitoring_counters", counts: { idempotency_missing: 2, write_storm_429: 1 } }),
    JSON.stringify({ route: "/v1/plan/day", status: 500 }),
    JSON.stringify({ route: "/v1/plan/day", status: 404 }),
  ].join("\n");

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, sample, "utf8");

  const res = spawnSync(process.execPath, ["scripts/collect-evidence.js"], {
    cwd: process.cwd(),
    env: { ...process.env, LOG_PATHS: logPath },
    encoding: "utf8",
  });

  await fs.unlink(logPath).catch(() => {});

  assert(res.status === 0, "collect-evidence should exit 0");
  assert(!res.stdout.includes("payload"), "collect-evidence should not include payloads");
  const parsed = JSON.parse(res.stdout);
  assert(parsed.artifacts.contractInvalidRequestIds.includes("req-1"), "should include contract invalid requestId");
  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
