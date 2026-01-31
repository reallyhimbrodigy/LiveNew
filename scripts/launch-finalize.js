// Runbook: set BASE_URL (or SIM_BASE_URL), SIM_AUTH_TOKEN, and lock env vars before full traffic.
import { spawn } from "child_process";
import path from "path";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";
import { verifyHashes } from "../src/server/lockChecks.js";
import { CONTRACT_LOCK_HASHES, DOMAIN_LOCK_HASHES } from "../src/server/lockHashes.js";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const CANARY_ALLOWLIST = (process.env.CANARY_ALLOWLIST || "").trim();
const SKIP_PERF = process.env.SKIP_PERF_GATE === "true";

function requireLock(flag) {
  return process.env[flag] === "true";
}

async function verifyLockHashes(kind, expected) {
  const result = await verifyHashes({ rootDir: process.cwd(), expected, kind });
  return result;
}

function runNode(scriptPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function run() {
  const operateCheck = await runNode(path.join(ROOT, "scripts", "operate-mode-check.js"));
  if (!operateCheck.ok) {
    console.error(operateCheck.stderr || operateCheck.stdout || "operate-mode-check failed");
    process.exit(1);
  }
  const missingLocks = [];
  if (!requireLock("FREEZE_LIB_VERSION")) missingLocks.push("FREEZE_LIB_VERSION");
  if (!process.env.EXPECTED_LIB_VERSION) missingLocks.push("EXPECTED_LIB_VERSION");
  if (!requireLock("CONTRACT_LOCK")) missingLocks.push("CONTRACT_LOCK");
  if (!requireLock("DOMAIN_LOCK")) missingLocks.push("DOMAIN_LOCK");
  if (!requireLock("STATIC_ROOT_LOCK")) missingLocks.push("STATIC_ROOT_LOCK");
  if (!process.env.EXPECTED_STATIC_ROOT) missingLocks.push("EXPECTED_STATIC_ROOT");

  if (missingLocks.length) {
    console.error(JSON.stringify({ ok: false, error: "missing_locks", missing: missingLocks }));
    process.exit(1);
  }

  if (String(LIB_VERSION) !== String(process.env.EXPECTED_LIB_VERSION || "")) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "lib_version_mismatch",
        expected: process.env.EXPECTED_LIB_VERSION,
        actual: String(LIB_VERSION),
      })
    );
    process.exit(1);
  }

  const contractResult = await verifyLockHashes("contract", CONTRACT_LOCK_HASHES);
  if (!contractResult.ok) {
    console.error(JSON.stringify({ ok: false, error: "contract_lock_mismatch", mismatches: contractResult.mismatches }));
    process.exit(1);
  }

  const domainResult = await verifyLockHashes("domain", DOMAIN_LOCK_HASHES);
  if (!domainResult.ok) {
    console.error(JSON.stringify({ ok: false, error: "domain_lock_mismatch", mismatches: domainResult.mismatches }));
    process.exit(1);
  }

  if (CANARY_ALLOWLIST) {
    console.error(JSON.stringify({ ok: false, error: "canary_still_enabled", canaryAllowlist: CANARY_ALLOWLIST }));
    process.exit(1);
  }

  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }

  const results = [];
  results.push({ step: "operate_mode_check", ...operateCheck });
  results.push({ step: "lib_version_bump", ...(await runNode(path.join(ROOT, "scripts", "check-lib-version-bump.js"))) });
  results.push({ step: "client_parity", ...(await runNode(path.join(ROOT, "scripts", "check-client-parity.js"))) });
  results.push({ step: "verify_static_root", ...(await runNode(path.join(ROOT, "scripts", "verify-static-root.js"))) });
  results.push({ step: "verify_static_esm", ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"), { BASE_URL })) });
  results.push({
    step: "simulate_short",
    ...(await runNode(path.join(ROOT, "scripts", "simulate.js"), {
      SIM_BASE_URL: BASE_URL,
      SIM_DAYS: "3",
      SIM_CONCURRENCY: "false",
    })),
  });
  if (!SKIP_PERF) {
    results.push({ step: "perf_gate", ...(await runNode(path.join(ROOT, "scripts", "perf-gate.js"), { BASE_URL })) });
  }

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    message: ok ? "READY FOR FULL TRAFFIC" : "NOT READY",
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
