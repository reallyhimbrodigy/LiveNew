// Runbook: execute cadence scripts under STABILITY_WINDOW.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");

function parseMode(argv) {
  if (argv.includes("--daily")) return "daily";
  if (argv.includes("--nightly")) return "nightly";
  if (argv.includes("--weekly")) return "weekly";
  return null;
}

function run() {
  if (process.env.STABILITY_WINDOW !== "true") {
    const out = { ok: false, error: "STABILITY_WINDOW must be true" };
    console.log(USE_JSON ? JSON.stringify(out) : "stability_window ok=false error=missing_flag");
    process.exit(2);
  }

  const mode = parseMode(process.argv);
  if (!mode) {
    const out = { ok: false, error: "missing_mode", required: "--daily|--nightly|--weekly" };
    console.log(USE_JSON ? JSON.stringify(out) : "stability_window ok=false error=missing_mode");
    process.exit(2);
  }

  const scriptName = mode === "daily" ? "cron-daily.js" : mode === "nightly" ? "cron-nightly.js" : "cron-weekly.js";
  const result = runNode(path.join(ROOT, "scripts", scriptName), { args: ["--json"] });

  const artifactPath = writeArtifact("stability", `stability-${mode}`, {
    ok: result.ok,
    mode,
    exitCode: result.code ?? 1,
    ranAt: new Date().toISOString(),
    result: result.parsed || null,
  });

  const out = { ok: result.ok, mode, artifactPath };
  console.log(USE_JSON ? JSON.stringify(out) : `stability_window ok=${out.ok} mode=${mode} artifact=${artifactPath}`);
  process.exit(result.code ?? 1);
}

run();
