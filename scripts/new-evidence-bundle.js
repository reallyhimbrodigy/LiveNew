// Runbook: create or update an evidence bundle artifact.
import fs from "fs";
import path from "path";
import { writeEvidenceBundle } from "./lib/evidence-bundle.js";

function parseArgs(argv) {
  const args = { logs: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      if (name === "log") args.logs.push(value);
      else args[name] = value;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

function tailLines(filePath, count) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(Math.max(0, lines.length - count));
  } catch {
    return [];
  }
}

function collectLogTails(paths, count) {
  return paths
    .map((logPath) => ({ path: logPath, lines: tailLines(logPath, count) }))
    .filter((entry) => entry.lines.length > 0);
}

function run() {
  const args = parseArgs(process.argv);
  const strict = args.strict || process.env.STRICT === "true";
  const evidenceId = (process.env.REQUIRED_EVIDENCE_ID || "").trim() || (strict ? "" : `MISSING-${Date.now()}`);
  if (!evidenceId) {
    console.error(JSON.stringify({ ok: false, error: "missing_required_evidence_id" }));
    process.exit(2);
  }

  const requestId = args.requestId || process.env.REQUEST_ID || "";
  const scenarioPack = args.scenario || process.env.SCENARIO_PACK || "";
  const notes = args.notes || "";
  const type = args.type || "manual";

  const logPaths = args.logs.length
    ? args.logs
    : (process.env.EVIDENCE_LOG_PATHS || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  const tailCount = Number(args.tail || process.env.EVIDENCE_LOG_TAIL || 50);
  const logs = logPaths.length ? collectLogTails(logPaths, Number.isFinite(tailCount) ? tailCount : 50) : null;

  const filePath = writeEvidenceBundle({
    evidenceId,
    type,
    requestId,
    scenarioPack,
    notes,
    extra: { source: "new-evidence-bundle" },
    logs,
  });

  console.log(JSON.stringify({ ok: true, evidenceId, path: filePath }));
}

run();
