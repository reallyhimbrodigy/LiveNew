// Runbook: verifies LIB_VERSION bump when src/domain/libraries changes.
import { spawnSync } from "child_process";

const DIFF_OVERRIDE = (process.env.LIB_VERSION_DIFF_FILES || "").trim();
const STRICT_GIT_CHECK = process.env.STRICT_GIT_CHECK === "true" || process.argv.includes("--strict");
const USE_JSON = process.argv.includes("--json");
const LIBRARY_PREFIX = "src/domain/libraries/";
const VERSION_FILE = "src/domain/libraryVersion.js";

function parseList(value) {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runGit(args) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    return { ok: false, error: res.error?.message || "git_command_failed" };
  }
  return { ok: true, output: res.stdout || "" };
}

function readDiffFiles() {
  if (DIFF_OVERRIDE) return parseList(DIFF_OVERRIDE);
  const diff = runGit(["diff", "--name-only", "HEAD"]);
  if (!diff.ok) {
    return { warning: diff.error || "git_diff_failed", files: [] };
  }
  const diffFiles = parseList(diff.output);
  const status = runGit(["status", "--porcelain"]);
  if (status.ok) {
    const statusFiles = parseList(status.output)
      .map((line) => line.replace(/^..\\s+/, "").trim())
      .map((line) => (line.includes("->") ? line.split("->").pop().trim() : line))
      .filter(Boolean);
    return { files: Array.from(new Set([...diffFiles, ...statusFiles])) };
  }
  return { files: diffFiles, warning: status.error };
}

function run() {
  const result = readDiffFiles();
  const files = Array.isArray(result) ? result : result.files || [];
  if (!files.length && result?.warning) {
    const output = { ok: true, warning: result.warning };
    if (STRICT_GIT_CHECK) {
      console.error(JSON.stringify({ ok: false, error: "git_unavailable", warning: result.warning }));
      process.exit(2);
    }
    console.log(USE_JSON ? JSON.stringify(output) : JSON.stringify(output));
    return;
  }
  const libraryChanges = files.filter((file) => file.startsWith(LIBRARY_PREFIX));
  const versionChanged = files.includes(VERSION_FILE);
  if (libraryChanges.length && !versionChanged) {
    const err = {
      ok: false,
      error: "lib_version_not_bumped",
      libraries: libraryChanges,
      required: VERSION_FILE,
    };
    console.error(JSON.stringify(err));
    process.exit(1);
  }
  const out = { ok: true, libraries: libraryChanges, versionChanged };
  console.log(USE_JSON ? JSON.stringify(out) : JSON.stringify(out));
}

run();
