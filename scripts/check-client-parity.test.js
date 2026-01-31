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

  console.log(JSON.stringify({ ok: true }));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
