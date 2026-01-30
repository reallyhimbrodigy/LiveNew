import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const AUTH_TOKEN = process.env.SIM_AUTH_TOKEN || process.env.AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const DAYS = String(Math.max(1, Number(process.env.SIM_DAYS || 3)));
const CONCURRENCY = process.env.SIM_CONCURRENCY || "true";
const FAIL_ON_WARNINGS = process.env.FAIL_ON_WARNINGS === "true";

function parseJsonLine(output) {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // try next
    }
  }
  return null;
}

async function loadScenarios() {
  const dir = path.join(ROOT, "scripts", "scenarios");
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return files.map((name) => name.replace(/\.json$/, ""));
}

function runSim(scenarioId) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      SIM_BASE_URL: BASE_URL,
      SIM_AUTH_TOKEN: AUTH_TOKEN,
      SIM_SCENARIO: scenarioId,
      SIM_DAYS: DAYS,
      SIM_CONCURRENCY: CONCURRENCY,
    };
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "simulate.js")], { cwd: ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      const parsed = parseJsonLine(stdout) || parseJsonLine(stderr) || null;
      resolve({
        scenario: scenarioId,
        ok: code === 0 && parsed?.ok === true,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        result: parsed,
      });
    });
  });
}

async function main() {
  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL required" }));
    process.exit(1);
  }

  const scenarios = await loadScenarios();
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runSim(scenario));
  }

  const totals = {
    gatingViolations: 0,
    missingIdempotencyWarnings: 0,
    rateLimited: 0,
    nondeterminism: 0,
  };
  const failures = [];

  results.forEach((entry) => {
    if (!entry.ok) failures.push({ scenario: entry.scenario, code: entry.code, error: entry.result?.error || null });
    const stats = entry.result?.stats || {};
    totals.rateLimited += stats.rateLimited || 0;
    totals.gatingViolations += stats.gatingViolations || 0;
    totals.missingIdempotencyWarnings += stats.idempotencyMissing || 0;
    totals.nondeterminism += entry.result?.nondeterminism || 0;
  });

  const warningCount =
    totals.gatingViolations +
    totals.missingIdempotencyWarnings +
    totals.rateLimited +
    totals.nondeterminism;
  const ok = failures.length === 0;
  const status = {
    ok: ok && (!FAIL_ON_WARNINGS || warningCount === 0),
    baseUrl: BASE_URL,
    scenarios: results.map((entry) => ({
      scenario: entry.scenario,
      ok: entry.ok,
      code: entry.code,
      nondeterminism: entry.result?.nondeterminism ?? null,
      stats: entry.result?.stats || {},
      error: entry.ok ? null : entry.result?.error || entry.stderr || entry.stdout || null,
    })),
    warnings: totals,
    failures,
  };

  console.log(JSON.stringify(status, null, 2));
  if (!status.ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
