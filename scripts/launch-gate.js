import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const BASE_URL = process.env.SIM_BASE_URL || process.env.BASE_URL || "";
const AUTH_TOKEN = process.env.SIM_AUTH_TOKEN || process.env.AUTH_TOKEN || process.env.SMOKE_TOKEN || "";
const DRY_RUN = process.env.LAUNCH_GATE_DRY_RUN === "true";
const OUTPUT_DIR = process.env.LAUNCH_GATE_OUTPUT_DIR || path.join(ROOT, "data", "launch-gate");
const LOG_PATHS = (process.env.LAUNCH_GATE_LOG_PATHS || process.env.LOG_PATHS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function parseJsonLine(output) {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;
  const lines = trimmed.split("\n").filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // next
    }
  }
  return null;
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
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        parsed: parseJsonLine(stdout) || parseJsonLine(stderr),
      });
    });
  });
}

async function runSim(label, { days, concurrency }) {
  const env = {
    SIM_BASE_URL: BASE_URL,
    SIM_AUTH_TOKEN: AUTH_TOKEN,
    SIM_DAYS: String(days),
    SIM_CONCURRENCY: concurrency ? "true" : "false",
  };
  const res = await runNode(path.join(ROOT, "scripts", "simulate.js"), env);
  const outPath = path.join(OUTPUT_DIR, `${label}.json`);
  await fs.writeFile(outPath, JSON.stringify(res.parsed || { ok: res.ok, stdout: res.stdout, stderr: res.stderr }, null, 2));
  return { ...res, outputPath: outPath };
}

async function scanLogs(paths) {
  const counts = { nondeterminism: 0, contractInvalid: 0 };
  for (const logPath of paths) {
    let raw = "";
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split("\n").filter(Boolean);
    lines.forEach((line) => {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const event = entry?.event || "";
      if (event === "nondeterminism_detected") counts.nondeterminism += 1;
      if (event === "today_contract_invalid") counts.contractInvalid += 1;
      if (event === "monitoring_counters") {
        const c = entry?.counts || {};
        counts.nondeterminism += Number(c.nondeterminism || 0);
        counts.contractInvalid += Number(c.contract_invalid || 0);
      }
    });
  }
  return counts;
}

async function main() {
  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          steps: [
            "golden.snapshots",
            "mvp.unit",
            "verify_static_esm",
            "cache_headers",
            "export_surface",
            "bootstrap_gate",
            "static_smoke",
            "simulate_short",
            "simulate_long",
            "simulate_concurrency",
            "db-profile",
          ],
        },
        null,
        2
      )
    );
    return;
  }

  if (!BASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "SIM_BASE_URL or BASE_URL required" }));
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const results = [];
  results.push({ step: "golden.snapshots", ...(await runNode(path.join(ROOT, "scripts", "golden.snapshots.js"))) });
  results.push({ step: "mvp.unit", ...(await runNode(path.join(ROOT, "scripts", "mvp.unit.test.js"))) });
  results.push({ step: "verify_static_esm", ...(await runNode(path.join(ROOT, "scripts", "verify-static-esm.js"))) });
  results.push({ step: "cache_headers", ...(await runNode(path.join(ROOT, "scripts", "cache-headers.test.js"))) });
  results.push({ step: "export_surface", ...(await runNode(path.join(ROOT, "scripts", "export-surface.test.js"))) });
  results.push({ step: "bootstrap_gate", ...(await runNode(path.join(ROOT, "scripts", "bootstrap-gate.test.js"))) });
  results.push({ step: "static_smoke", ...(await runNode(path.join(ROOT, "scripts", "static-smoke.test.js"))) });

  results.push({ step: "simulate_short", ...(await runSim("simulate_short", { days: 3, concurrency: false })) });
  results.push({ step: "simulate_long", ...(await runSim("simulate_long", { days: 7, concurrency: false })) });
  results.push({ step: "simulate_concurrency", ...(await runSim("simulate_concurrency", { days: 3, concurrency: true })) });

  results.push({ step: "db-profile", ...(await runNode(path.join(ROOT, "scripts", "db-profile.js"))) });

  const nondeterminism = results
    .filter((entry) => entry.parsed && typeof entry.parsed.nondeterminism === "number")
    .reduce((sum, entry) => sum + entry.parsed.nondeterminism, 0);

  let logCounters = { nondeterminism: 0, contractInvalid: 0 };
  if (LOG_PATHS.length) {
    logCounters = await scanLogs(LOG_PATHS);
  }

  const ok =
    results.every((entry) => entry.ok) &&
    nondeterminism === 0 &&
    logCounters.nondeterminism === 0 &&
    logCounters.contractInvalid === 0;

  const summary = {
    ok,
    baseUrl: BASE_URL,
    steps: results.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      outputPath: entry.outputPath || null,
      note: entry.ok ? entry.stdout || null : entry.stderr || entry.stdout || null,
    })),
    nondeterminism,
    logCounters,
    outputDir: OUTPUT_DIR,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
