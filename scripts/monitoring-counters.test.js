import assert from "node:assert";
import { createMonitoringCounters } from "../src/server/monitoring/counters.js";

function run() {
  const logs = [];
  const counters = createMonitoringCounters({ logFn: (entry) => logs.push(entry), intervalMs: 1000 });
  counters.increment("nondeterminism_detected", { route: "/v1/rail/today", status: 500 });
  counters.increment("write_storm", { route: "/v1/checkin", status: 429 });
  counters.increment("idempotency_missing", { route: "/v1/checkin" }, 2);
  counters.increment("idempotency_duplicate", { route: "/v1/checkin", status: 200 });
  counters.flush("test");

  assert.strictEqual(logs.length, 1, "flush should emit one log entry");
  const entry = logs[0];
  assert.strictEqual(entry.event, "monitoring_counters");
  assert(entry.counts.nondeterminism_detected === 1, "nondeterminism counter should be present");
  assert(entry.counts.write_storm_429 === 1, "write_storm alias should map to write_storm_429");
  assert(entry.counts.idempotency_missing === 2, "idempotency_missing should count increments");
  assert(entry.counts.idempotency_duplicate === 1, "idempotency_duplicate should be present");
  assert(Array.isArray(entry.series), "series should be present when labels provided");
}

run();
