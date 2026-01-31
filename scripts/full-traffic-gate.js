// Runbook: full-traffic gate wrapper (aliases launch-finalize).
// Canonical full-traffic gate for production rollout.
import path from "path";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";
import { verifyHashes } from "../src/server/lockChecks.js";
import { CONTRACT_LOCK_HASHES, DOMAIN_LOCK_HASHES } from "../src/server/lockHashes.js";
import { runNode } from "./lib/exec.js";
import { isCanaryEnabled } from "./lib/canary.js";
import { writeEvidenceBundle } from "./lib/evidence-bundle.js";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const CANARY_ALLOWLIST = (process.env.CANARY_ALLOWLIST || "").trim();
const SKIP_PERF = process.env.PERF_SKIP === "true" || process.env.SKIP_PERF_GATE === "true";
const USE_JSON = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");

function requireLock(flag) {
  return process.env[flag] === "true";
}

function runScript(scriptName, env = {}, args = []) {
  return runNode(path.join(ROOT, "scripts", scriptName), { env, args });
}

async function verifyLockHashes(kind, expected) {
  const result = await verifyHashes({ rootDir: process.cwd(), expected, kind });
  return result;
}

function summarizeLine(summary) {
  const failed = summary.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return `full_traffic_gate ok=${summary.ok} failed=${failed.length ? failed.join(",") : "none"}`;
}

function outputAndExit(summary, exitCode) {
  let evidenceBundlePath = null;
  if (exitCode !== 0) {
    evidenceBundlePath = writeEvidenceBundle({
      evidenceId: (process.env.REQUIRED_EVIDENCE_ID || "").trim(),
      type: "full_traffic_gate",
      requestId: (process.env.REQUEST_ID || "").trim(),
      scenarioPack: (process.env.SCENARIO_PACK || "").trim(),
      extra: {
        error: summary?.error || null,
        missing: summary?.missing || null,
        steps: summary?.steps || null,
      },
    });
  }
  const out = evidenceBundlePath ? { ...summary, evidenceBundlePath } : summary;
  console.log(USE_JSON ? JSON.stringify(out) : summarizeLine(out));
  process.exit(exitCode);
}

async function run() {
  const results = [];
  const operateCheck = runScript("operate-mode-check.js");
  const evidenceBundle = operateCheck.parsed?.evidenceBundle || null;
  results.push({ step: "operate_mode_check", ...operateCheck });
  if (!operateCheck.ok) {
    outputAndExit({ ok: false, steps: results, evidenceBundle }, operateCheck.code === 2 ? 2 : 1);
  }

  const missingLocks = [];
  if (!requireLock("FREEZE_LIB_VERSION")) missingLocks.push("FREEZE_LIB_VERSION");
  if (!process.env.EXPECTED_LIB_VERSION) missingLocks.push("EXPECTED_LIB_VERSION");
  if (!requireLock("CONTRACT_LOCK")) missingLocks.push("CONTRACT_LOCK");
  if (!requireLock("DOMAIN_LOCK")) missingLocks.push("DOMAIN_LOCK");
  if (!requireLock("STATIC_ROOT_LOCK")) missingLocks.push("STATIC_ROOT_LOCK");
  if (!process.env.EXPECTED_STATIC_ROOT) missingLocks.push("EXPECTED_STATIC_ROOT");
  if (missingLocks.length) {
    outputAndExit({ ok: false, error: "missing_locks", missing: missingLocks, steps: results, evidenceBundle }, 2);
  }

  if (String(LIB_VERSION) !== String(process.env.EXPECTED_LIB_VERSION || "")) {
    outputAndExit(
      {
        ok: false,
        error: "lib_version_mismatch",
        expected: process.env.EXPECTED_LIB_VERSION,
        actual: String(LIB_VERSION),
        steps: results,
        evidenceBundle,
      },
      1
    );
  }

  const contractResult = await verifyLockHashes("contract", CONTRACT_LOCK_HASHES);
  if (!contractResult.ok) {
    outputAndExit(
      { ok: false, error: "contract_lock_mismatch", mismatches: contractResult.mismatches, steps: results, evidenceBundle },
      1
    );
  }

  const domainResult = await verifyLockHashes("domain", DOMAIN_LOCK_HASHES);
  if (!domainResult.ok) {
    outputAndExit(
      { ok: false, error: "domain_lock_mismatch", mismatches: domainResult.mismatches, steps: results, evidenceBundle },
      1
    );
  }

  if (process.env.CATALOG_RELEASE_MODE === "true") {
    const releaseCheck = runScript("catalog-release-check.js", {}, STRICT ? ["--strict"] : []);
    results.push({ step: "catalog_release_check", ...releaseCheck });
    if (!releaseCheck.ok) {
      outputAndExit({ ok: false, error: "catalog_release_check_failed", steps: results, evidenceBundle }, 1);
    }
  }

  if (isCanaryEnabled()) {
    outputAndExit(
      { ok: false, error: "canary_still_enabled", canaryAllowlist: CANARY_ALLOWLIST, steps: results, evidenceBundle },
      2
    );
  }

  if (!BASE_URL) {
    outputAndExit({ ok: false, error: "missing_base_url", steps: results, evidenceBundle }, 2);
  }

  const libCheck = runScript("check-lib-version-bump.js", {}, STRICT ? ["--strict"] : []);
  results.push({ step: "lib_version_bump", ...libCheck });
  if (libCheck.parsed?.libraries?.length) {
    results.push({ step: "catalog_coverage", ...runScript("constraints.coverage.test.js") });
  }

  results.push({ step: "verify_static_root", ...runScript("verify-static-root.js") });
  results.push({ step: "verify_static_esm", ...runScript("verify-static-esm.js", { BASE_URL }) });
  results.push({
    step: "simulate_short",
    ...runScript("simulate.js", { SIM_BASE_URL: BASE_URL, SIM_DAYS: "3", SIM_CONCURRENCY: "false" }),
  });
  results.push({ step: "client_parity", ...runScript("check-client-parity.js") });
  if (!SKIP_PERF) {
    results.push({ step: "perf_gate", ...runScript("perf-gate.js", { BASE_URL }) });
  }

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    evidenceBundle,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };
  outputAndExit(summary, ok ? 0 : 1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
