// Runbook: set BASE_URL and optional LOAD_TEST_PRESET, P95/P99 thresholds.
import { spawn } from "child_process";
import path from "path";
import { writeArtifact } from "./lib/artifacts.js";
import { writeEvidenceBundle } from "./lib/evidence-bundle.js";
import { parseJsonLine } from "./lib/exec.js";

const ROOT = process.cwd();
const MOCK = process.env.PERF_GATE_MOCK === "true";
const BASE_URL = process.env.BASE_URL || process.env.SIM_BASE_URL || "";

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
  if (MOCK) {
    const loadOk = process.env.PERF_GATE_LOAD_OK !== "false";
    const dbOk = process.env.PERF_GATE_DB_OK !== "false";
    const ok = loadOk && dbOk;
    const preset = process.env.PERF_PRESET || process.env.LOAD_TEST_PRESET || null;
    const summary = {
      ok,
      mock: true,
      preset,
      loadTest: { ok: loadOk, preset },
      dbProfile: { ok: dbOk },
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!ok) {
      const artifactPath = writeArtifact("incidents/perf", "perf", summary);
      writeEvidenceBundle({
        evidenceId: (process.env.REQUIRED_EVIDENCE_ID || "").trim(),
        type: "perf",
        requestId: (process.env.REQUEST_ID || "").trim(),
        scenarioPack: (process.env.SCENARIO_PACK || "").trim(),
        extra: { artifactPath, mock: true },
      });
      process.exit(1);
    }
    return;
  }

  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "BASE_URL or SIM_BASE_URL required" }));
    process.exit(1);
  }

  const results = [];
  const dbProfile = await runNode(path.join(ROOT, "scripts", "db-profile.js"));
  const loadTest = await runNode(path.join(ROOT, "scripts", "load-test.js"), { BASE_URL });
  results.push({ step: "db_profile", ...dbProfile, parsed: parseJsonLine(dbProfile.stdout) || parseJsonLine(dbProfile.stderr) });
  results.push({ step: "load_test", ...loadTest, parsed: parseJsonLine(loadTest.stdout) || parseJsonLine(loadTest.stderr) });

  const ok = results.every((entry) => entry.ok);
  const summary = {
    ok,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
    loadTest: results.find((entry) => entry.step === "load_test")?.parsed || null,
    dbProfile: results.find((entry) => entry.step === "db_profile")?.parsed || null,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    const artifactPath = writeArtifact("incidents/perf", "perf", summary);
    writeEvidenceBundle({
      evidenceId: (process.env.REQUIRED_EVIDENCE_ID || "").trim(),
      type: "perf",
      requestId: (process.env.REQUEST_ID || "").trim(),
      scenarioPack: (process.env.SCENARIO_PACK || "").trim(),
      extra: { artifactPath },
    });
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
