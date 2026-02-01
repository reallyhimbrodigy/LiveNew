import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-parity-escalate-"));
const incidentDir = path.join(tmpDir, "incidents", "parity");
await fs.mkdir(incidentDir, { recursive: true });
const incidentPath = path.join(incidentDir, "parity.json");
await fs.writeFile(
  incidentPath,
  JSON.stringify({
    failures: [{ metric: "checkin", reason: "latest_below_threshold" }],
    missingHeaders: { "Idempotency-Key (checkin)": 10 },
    rootCauseClass: "client",
    allowedRemediation: "client_headers_retry_backoff_only",
  })
);

const res = spawnSync(process.execPath, ["scripts/parity-escalate.js", "--json"], {
  cwd: process.cwd(),
  env: { ...process.env, ARTIFACTS_DIR: tmpDir },
  encoding: "utf8",
});

assert(res.status === 1, "parity-escalate should exit 1 when parity below thresholds");
const parsed = JSON.parse(res.stdout || "{}");
assert(Array.isArray(parsed.checklist), "parity-escalate should print checklist");
assert(parsed.artifactPath, "parity-escalate should write escalation artifact");

console.log(JSON.stringify({ ok: true }));
