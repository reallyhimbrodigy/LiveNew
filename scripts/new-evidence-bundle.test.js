import { spawnSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "livenew-evidence-"));
const res = spawnSync(
  process.execPath,
  ["scripts/new-evidence-bundle.js", "--requestId", "req-123", "--scenario", "scenario-pack", "--notes", "note", "--type", "bug"],
  {
    cwd: process.cwd(),
    env: { ...process.env, REQUIRED_EVIDENCE_ID: "EV-123", ARTIFACTS_DIR: tmpDir },
    encoding: "utf8",
  }
);

assert(res.status === 0, "new-evidence-bundle should exit 0");
const parsed = JSON.parse(res.stdout);
assert(parsed.path, "new-evidence-bundle should report output path");
const content = JSON.parse(await fs.readFile(parsed.path, "utf8"));
assert(content.evidenceId === "EV-123", "evidence bundle should include evidenceId");
assert(content.events?.length > 0, "evidence bundle should include events");

console.log(JSON.stringify({ ok: true }));
