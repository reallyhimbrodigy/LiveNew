import fs from "fs/promises";
import path from "path";
import { checkDbConnection, checkRequiredIndexes, getDbPath } from "../state/db.js";
import { getSecretKeyStatus } from "./env.js";

async function checkDataDirWritable(dir) {
  const testPath = path.join(dir, `.write-test-${process.pid}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(testPath, "ok");
    await fs.unlink(testPath);
    return true;
  } catch {
    return false;
  }
}

export async function computeBootSummary(config) {
  let storageOk = true;
  let storageDetails = "";
  try {
    await checkDbConnection();
    storageDetails = getDbPath();
  } catch (err) {
    storageOk = false;
    storageDetails = err?.message || "db_unavailable";
  }
  let indexesOk = true;
  let missingIndexes = [];
  if (storageOk) {
    try {
      const indexCheck = await checkRequiredIndexes();
      indexesOk = indexCheck.ok;
      missingIndexes = indexCheck.missing || [];
    } catch {
      indexesOk = false;
      missingIndexes = ["index_check_failed"];
    }
  } else {
    indexesOk = false;
    missingIndexes = ["db_unavailable"];
  }

  const dataDirWritable = await checkDataDirWritable(config.dataDir);
  const secretStatus = getSecretKeyStatus();
  const adminCount = config.adminEmails?.size || 0;

  return {
    app: "LiveNew",
    envMode: config.envMode,
    node: process.version,
    port: config.port,
    storage: { kind: "db", ok: storageOk, details: storageDetails },
    indexes: { ok: indexesOk, missing: missingIndexes },
    dataDir: { path: config.dataDir, writable: dataDirWritable },
    secretKey: { present: secretStatus.secretKeyPresent, ephemeral: secretStatus.secretKeyEphemeral },
    auth: { required: config.requireAuth },
    devRoutes: { enabled: config.devRoutesEnabled },
    csrf: { enabled: config.csrfEnabled },
    admin: { configured: adminCount > 0, count: adminCount },
  };
}
