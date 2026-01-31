// Runbook: verifies LIB_VERSION bump when src/domain/libraries changes.
import { spawnSync } from "child_process";

const DIFF_OVERRIDE = (process.env.LIB_VERSION_DIFF_FILES || "").trim();
const LIBRARY_PREFIX = "src/domain/libraries/";
const VERSION_FILE = "src/domain/libraryVersion.js";

function parseList(value) {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readDiffFiles() {
  if (DIFF_OVERRIDE) return parseList(DIFF_OVERRIDE);
  const res = spawnSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
  if (res.status !== 0) {
    return { warning: "git_diff_failed", files: [] };
  }
  const diffFiles = parseList(res.stdout);
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (status.status === 0) {
    const statusFiles = parseList(status.stdout)
      .map((line) => line.replace(/^..\\s+/, "").trim())
      .map((line) => (line.includes("->") ? line.split("->").pop().trim() : line))
      .filter(Boolean);
    return { files: Array.from(new Set([...diffFiles, ...statusFiles])) };
  }
  return { files: diffFiles };
}

function run() {
  const result = readDiffFiles();
  const files = Array.isArray(result) ? result : result.files || [];
  if (!files.length && result?.warning) {
    console.log(JSON.stringify({ ok: true, warning: result.warning }));
    return;
  }
  const libraryChanges = files.filter((file) => file.startsWith(LIBRARY_PREFIX));
  const versionChanged = files.includes(VERSION_FILE);
  if (libraryChanges.length && !versionChanged) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "lib_version_not_bumped",
        libraries: libraryChanges,
        required: VERSION_FILE,
      })
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, libraries: libraryChanges, versionChanged }));
}

run();
