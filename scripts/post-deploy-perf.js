// Runbook: post-deploy perf validation with prod preset.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();

function run() {
  const result = runNode(path.join(ROOT, "scripts", "perf-gate.js"), { env: { PERF_PRESET: "prod" } });
  if (!result.ok) {
    const artifactPath = writeArtifact("incidents/perf", "postdeploy", {
      ok: false,
      ranAt: new Date().toISOString(),
      exitCode: result.code ?? 1,
      perf: result.parsed || null,
    });
    console.log(JSON.stringify({ ok: false, artifactPath }));
    process.exit(result.code ?? 1);
  }

  const artifactPath = writeArtifact("perf", "postdeploy-pass", {
    ok: true,
    ranAt: new Date().toISOString(),
    perf: result.parsed || null,
  });
  console.log(JSON.stringify({ ok: true, artifactPath }));
}

run();
