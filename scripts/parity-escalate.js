// Runbook: summarize latest parity incident and enforce client remediation.
import fs from "fs";
import path from "path";
import { artifactsBaseDir, writeArtifact } from "./lib/artifacts.js";

const USE_JSON = process.argv.includes("--json");

function listParityIncidents() {
  const dir = path.join(artifactsBaseDir(), "incidents", "parity");
  try {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    return files.map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function latestIncident(paths) {
  const entries = paths
    .map((filePath) => {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const stat = fs.statSync(filePath);
        return { filePath, parsed, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0] || null;
}

function run() {
  const latest = latestIncident(listParityIncidents());
  if (!latest) {
    const out = { ok: false, error: "no_parity_incident_found" };
    console.log(USE_JSON ? JSON.stringify(out) : "parity_escalate ok=false error=no_parity_incident_found");
    process.exit(2);
  }

  const incident = latest.parsed || {};
  const failures = incident.failures || [];
  const checklist = [
    "Ensure Idempotency-Key is always set for checkin/quick writes",
    "Send If-None-Match on /today requests to enable 304 responses",
    "Apply retry with backoff + jitter on network errors (client-side)",
  ];
  const out = {
    ok: failures.length === 0,
    incidentPath: latest.filePath,
    root_cause_class: incident.root_cause_class || "client",
    allowed_remediation: incident.allowed_remediation || ["idempotency_header", "if-none-match", "retry_backoff"],
    failures,
    missingHeaders: incident.missingHeaders || null,
    checklist,
  };

  const artifactPath = writeArtifact("incidents/parity", "escalate", {
    ...out,
    ranAt: new Date().toISOString(),
  });
  const output = { ...out, artifactPath };
  console.log(USE_JSON ? JSON.stringify(output, null, 2) : `parity_escalate ok=${out.ok} incident=${latest.filePath}`);
  if (failures.length) process.exit(1);
}

run();
