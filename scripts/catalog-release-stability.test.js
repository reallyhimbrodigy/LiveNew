import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-catalog-stability-"));
const nightlyDir = path.join(tmpDir, "nightly");
const dailyDir = path.join(tmpDir, "daily");
await fs.mkdir(nightlyDir, { recursive: true });
await fs.mkdir(dailyDir, { recursive: true });
await fs.writeFile(path.join(nightlyDir, "nightly-1.json"), JSON.stringify({ ok: false }));
await fs.writeFile(
  path.join(dailyDir, "daily-1.json"),
  JSON.stringify({ ok: true, parity: { movingAverage: { checkin: 0.5, quick: 0.5, today: 0.5 } } })
);

const res = spawnSync(process.execPath, ["scripts/catalog-release-check.js", "--json"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CATALOG_FREEZE: "true",
    CATALOG_RELEASE_MODE: "true",
    CANARY_MODE: "true",
    CANARY_ALLOWLIST: "user@example.com",
    LIB_VERSION_DIFF_FILES: "src/domain/libraries/foo.js,src/domain/libraryVersion.js",
    ARTIFACTS_DIR: tmpDir,
    CATALOG_STABILITY_N: "1",
  },
  encoding: "utf8",
});

assert(res.status !== 0, "catalog-release-check should fail when stability criteria unmet");
console.log(JSON.stringify({ ok: true }));
