// Runbook: enforce evidence requirements for overrides during LAUNCH_WINDOW.
import { evaluateEvidence } from "./lib/require-evidence.js";
import { fileURLToPath } from "url";

function exitWith(result, code) {
  if (code !== 0) {
    console.error(JSON.stringify(result));
    process.exit(code);
  }
  console.log(JSON.stringify(result, null, 2));
}

function runCli() {
  const result = evaluateEvidence();
  if (!result.ok) {
    exitWith(result, 2);
    return;
  }
  exitWith(result, 0);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === process.argv[1]) {
  runCli();
}
