// Runbook: summarize latest perf incident with remediation checklist.
import fs from "fs";
import path from "path";
import { artifactsBaseDir } from "./lib/artifacts.js";

const BASE = artifactsBaseDir();
const USE_JSON = process.argv.includes("--json");

function listPerfIncidents() {
  const dir = path.join(BASE, "incidents", "perf");
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
  const incidents = listPerfIncidents();
  const postdeploy = incidents.filter((filePath) => filePath.includes("postdeploy"));
  const latest = latestIncident(postdeploy.length ? postdeploy : incidents);
  if (!latest) {
    const out = { ok: false, error: "no_perf_incident_found" };
    console.log(USE_JSON ? JSON.stringify(out) : "perf_report ok=false error=no_perf_incident_found");
    process.exit(2);
  }

  const incident = latest.parsed || {};
  const checklist = [
    "Review slow endpoints and regressions",
    "Confirm db-profile scan types for critical queries",
    "Apply suggested index targets (if safe) and re-run perf-gate",
  ];
  const report = {
    ok: true,
    incidentPath: latest.filePath,
    slowEndpoints: incident.slowEndpoints || [],
    regressions: incident.regressions || null,
    dbQueries: incident.dbQueries || [],
    suggested_index_targets: incident.suggested_index_targets || [],
    checklist,
  };

  if (USE_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      [
        `perf_report ok=true incident=${latest.filePath}`,
        `slow_endpoints=${(report.slowEndpoints || []).length}`,
        `suggested_index_targets=${(report.suggested_index_targets || []).join(",") || "none"}`,
        `checklist=${checklist.join(" | ")}`,
      ].join(" ")
    );
  }
}

run();
