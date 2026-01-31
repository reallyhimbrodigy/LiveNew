// Runbook: full-traffic gate wrapper (aliases launch-finalize).
import { spawnSync } from "child_process";
import path from "path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "launch-finalize.js"), ...args], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
