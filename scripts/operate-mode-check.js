// Runbook: enforce operate-only requirements when LAUNCH_WINDOW=true.
import { evaluateEvidence } from "./lib/require-evidence.js";
import { isCanaryEnabled } from "./lib/canary.js";

const LAUNCH_WINDOW = process.env.LAUNCH_WINDOW === "true";
const CANARY_MODE = process.env.CANARY_MODE === "true";
const CANARY_ALLOWLIST = (process.env.CANARY_ALLOWLIST || "").trim();
const CATALOG_FREEZE = process.env.CATALOG_FREEZE === "true";
const CATALOG_RELEASE_MODE = process.env.CATALOG_RELEASE_MODE === "true";
const CATALOG_RELEASE_INTENT = process.env.CATALOG_RELEASE_INTENT === "true";

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
  const canaryStillEnabled = isCanaryEnabled() && !CANARY_MODE;
  if (missingLocks.length) {
    console.error(JSON.stringify({ ok: false, error: "launch_window_locks_missing", missing: missingLocks }));
    process.exit(2);
  }
  if (!CATALOG_FREEZE) {
    console.error(JSON.stringify({ ok: false, error: "catalog_freeze_required" }));
    process.exit(2);
  }
  if (canaryStillEnabled) {
    console.error(JSON.stringify({ ok: false, error: "canary_still_enabled", canaryAllowlist: CANARY_ALLOWLIST }));
    process.exit(2);
  }
  if (CATALOG_RELEASE_INTENT && !CATALOG_RELEASE_MODE) {
    console.error(JSON.stringify({ ok: false, error: "catalog_release_mode_required" }));
    process.exit(2);
  }
  const evidence = evaluateEvidence();
  if (!evidence.ok) {
    console.error(JSON.stringify(evidence));
    process.exit(2);
  }

  console.log(
    JSON.stringify({
      ok: true,
      launchWindow: true,
      canaryMode: CANARY_MODE,
      canaryAllowlist: CANARY_ALLOWLIST || null,
      catalogFreeze: CATALOG_FREEZE,
      catalogReleaseMode: CATALOG_RELEASE_MODE,
      override: evidence.override || false,
      evidenceId: evidence.evidenceId || null,
      evidenceBundle: evidence.evidenceBundle || null,
    })
  );
}

run();
