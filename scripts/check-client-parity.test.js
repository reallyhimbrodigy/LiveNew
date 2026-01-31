import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-parity-"));
  const failPath = path.join(tmpDir, "parity-fail.log");
  const okPath = path.join(tmpDir, "parity-ok.log");

  await fs.writeFile(
    failPath,
    `${JSON.stringify({
      event: "client_parity",
      checkin: { pctWithKey: 50 },
      quick: { pctWithKey: 100 },
      today: { pctIfNoneMatch: 100 },
    })}\n`
  );

  const failRes = spawnSync(process.execPath, ["scripts/check-client-parity.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PARITY_LOG_PATH: failPath },
    encoding: "utf8",
  });
  assert(failRes.status !== 0, "check-client-parity should fail below thresholds");

  await fs.writeFile(
    okPath,
    `${JSON.stringify({
      event: "client_parity",
      checkin: { pctWithKey: 99 },
      quick: { pctWithKey: 99 },
      today: { pctIfNoneMatch: 95 },
    })}\n`
  );

  const okRes = spawnSync(process.execPath, ["scripts/check-client-parity.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PARITY_LOG_PATH: okPath },
    encoding: "utf8",
  });
  assert(okRes.status === 0, "check-client-parity should pass when above thresholds");

  const driftPath = path.join(tmpDir, "parity-drift.log");
  const driftEvents = [
    { event: "client_parity", checkin: { pctWithKey: 98 }, quick: { pctWithKey: 98 }, today: { pctIfNoneMatch: 98 } },
    { event: "client_parity", checkin: { pctWithKey: 97 }, quick: { pctWithKey: 97 }, today: { pctIfNoneMatch: 97 } },
    { event: "client_parity", checkin: { pctWithKey: 80 }, quick: { pctWithKey: 80 }, today: { pctIfNoneMatch: 80 } },
    { event: "client_parity", checkin: { pctWithKey: 79 }, quick: { pctWithKey: 79 }, today: { pctIfNoneMatch: 79 } },
  ];
  await fs.writeFile(driftPath, driftEvents.map((entry) => JSON.stringify(entry)).join("\n"));

  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-parity-artifacts-"));
  const driftRes = spawnSync(process.execPath, ["scripts/check-client-parity.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PARITY_LOG_PATH: driftPath,
      PARITY_MOVING_WINDOW: "2",
      PARITY_TAIL_LINES: "4",
      PARITY_TREND_DROP: "0.05",
      CHECKIN_IDEMPOTENCY_RATE: "0.5",
      QUICK_IDEMPOTENCY_RATE: "0.5",
      TODAY_IF_NONE_MATCH_RATE: "0.5",
      ARTIFACTS_DIR: artifactDir,
    },
    encoding: "utf8",
  });
  assert(driftRes.status !== 0, "check-client-parity should fail on trend drop");
  const parityArtifacts = await fs.readdir(path.join(artifactDir, "incidents", "parity"));
  assert(parityArtifacts.length > 0, "parity artifact should be written on failure");

  const maPath = path.join(tmpDir, "parity-ma.log");
  const maEvents = [
    { event: "client_parity", checkin: { pctWithKey: 99 }, quick: { pctWithKey: 99 }, today: { pctIfNoneMatch: 99 } },
    { event: "client_parity", checkin: { pctWithKey: 80 }, quick: { pctWithKey: 80 }, today: { pctIfNoneMatch: 80 } },
  ];
  await fs.writeFile(maPath, maEvents.map((entry) => JSON.stringify(entry)).join("\n"));
  const maRes = spawnSync(process.execPath, ["scripts/check-client-parity.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PARITY_LOG_PATH: maPath,
      PARITY_MOVING_WINDOW: "2",
      CHECKIN_IDEMPOTENCY_RATE: "0.5",
      QUICK_IDEMPOTENCY_RATE: "0.5",
      TODAY_IF_NONE_MATCH_RATE: "0.5",
      CHECKIN_IDEMPOTENCY_MA_RATE: "0.95",
      QUICK_IDEMPOTENCY_MA_RATE: "0.95",
      TODAY_IF_NONE_MATCH_MA_RATE: "0.95",
    },
    encoding: "utf8",
  });
  assert(maRes.status !== 0, "check-client-parity should fail when moving average below threshold");

  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
