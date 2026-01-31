// Legacy wrapper for canonical full-traffic gate.
import { spawnSync } from "child_process";
import path from "path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "full-traffic-gate.js"), ...args], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
