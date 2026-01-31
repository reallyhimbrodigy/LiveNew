// Runbook: enforce operate-only requirements when LAUNCH_WINDOW=true.
import fs from "fs";

const LAUNCH_WINDOW = process.env.LAUNCH_WINDOW === "true";
const CANARY_MODE = process.env.CANARY_MODE === "true";
const CANARY_ALLOWLIST = (process.env.CANARY_ALLOWLIST || "").trim();
const REQUIRED_EVIDENCE_ID = (process.env.REQUIRED_EVIDENCE_ID || "").trim();
const OVERRIDE_REASON = (process.env.OVERRIDE_REASON || "").trim();
const EVIDENCE_FILE = (process.env.EVIDENCE_FILE || "").trim();

function fail(error, details = {}) {
  console.error(JSON.stringify({ ok: false, error, ...details }));
  process.exit(1);
}

function run() {
  if (!LAUNCH_WINDOW) {
    console.log(JSON.stringify({ ok: true, launchWindow: false }));
    return;
  }

  const missingLocks = [];
  if (process.env.FREEZE_LIB_VERSION !== "true") missingLocks.push("FREEZE_LIB_VERSION");
  if (process.env.CONTRACT_LOCK !== "true") missingLocks.push("CONTRACT_LOCK");
  if (process.env.DOMAIN_LOCK !== "true") missingLocks.push("DOMAIN_LOCK");
  if (process.env.STATIC_ROOT_LOCK !== "true") missingLocks.push("STATIC_ROOT_LOCK");
  if (missingLocks.length) {
    fail("launch_window_locks_missing", { missing: missingLocks });
  }

  if (CANARY_ALLOWLIST && !CANARY_MODE) {
    fail("canary_still_enabled", { canaryAllowlist: CANARY_ALLOWLIST });
  }

  if (!REQUIRED_EVIDENCE_ID) {
    fail("missing_required_evidence_id");
  }

  if (!OVERRIDE_REASON && !EVIDENCE_FILE) {
    fail("missing_override_reason", { required: "OVERRIDE_REASON or EVIDENCE_FILE" });
  }

  if (EVIDENCE_FILE && !fs.existsSync(EVIDENCE_FILE)) {
    fail("evidence_file_missing", { evidenceFile: EVIDENCE_FILE });
  }

  console.log(
    JSON.stringify({
      ok: true,
      launchWindow: true,
      canaryMode: CANARY_MODE,
      canaryAllowlist: CANARY_ALLOWLIST || null,
      evidenceId: REQUIRED_EVIDENCE_ID,
    })
  );
}

run();
