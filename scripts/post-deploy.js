// Runbook: post-deploy enforcement wrapper.
import path from "path";
import { runNode } from "./lib/exec.js";
import { writeArtifact } from "./lib/artifacts.js";

const ROOT = process.cwd();
const USE_JSON = process.argv.includes("--json");

function run() {
  const runNightly = process.argv.includes("--nightly");
  const results = [];

  const perf = runNode(path.join(ROOT, "scripts", "post-deploy-perf.js"), { args: ["--json"] });
  results.push({ step: "post_deploy_perf", ...perf });
  if (!perf.ok) {
    const artifactPath = writeArtifact("deploy", "post-deploy", {
      ok: false,
      ranAt: new Date().toISOString(),
      steps: results.map((entry) => ({ step: entry.step, ok: entry.ok, code: entry.code })),
    });
    const out = { ok: false, artifactPath };
    console.log(USE_JSON ? JSON.stringify(out) : `post_deploy ok=false artifact=${artifactPath}`);
    process.exit(perf.code ?? 1);
  }

  if (runNightly) {
    const nightly = runNode(path.join(ROOT, "scripts", "cron-nightly.js"), { args: ["--json"] });
    results.push({ step: "cron_nightly", ...nightly });
    if (!nightly.ok) {
      const artifactPath = writeArtifact("deploy", "post-deploy", {
        ok: false,
        ranAt: new Date().toISOString(),
        steps: results.map((entry) => ({ step: entry.step, ok: entry.ok, code: entry.code })),
      });
      const out = { ok: false, artifactPath };
      console.log(USE_JSON ? JSON.stringify(out) : `post_deploy ok=false artifact=${artifactPath}`);
      process.exit(nightly.code ?? 1);
    }
  }

  const artifactPath = writeArtifact("deploy", "post-deploy", {
    ok: true,
    ranAt: new Date().toISOString(),
    steps: results.map((entry) => ({ step: entry.step, ok: entry.ok, code: entry.code })),
  });
  const out = { ok: true, artifactPath };
  console.log(USE_JSON ? JSON.stringify(out) : `post_deploy ok=true artifact=${artifactPath}`);
}

run();
