import fs from "fs/promises";
import path from "path";
import { getDb, listFeatureFlags } from "../state/db.js";

export const ALPHA_REQUIRED = [
  "consent_gate",
  "rail_today",
  "outcomes",
  "snapshots",
  "validator",
  "rollback",
  "support_replay",
];

const REQUIRED_FLAGS = [
  "engine.regen.enabled",
  "engine.checkins.enabled",
  "engine.signals.enabled",
  "engine.reentry.enabled",
  "community.enabled",
  "rules.safety.enabled",
];

const REQUIRED_FEATURES = {
  consent_gate: {
    routes: ["/v1/consent/status", "/v1/consent/accept"],
    tables: ["user_consents", "consent_meta"],
  },
  rail_today: {
    routes: ["/v1/rail/today"],
    tables: ["user_state", "content_items"],
    flags: REQUIRED_FLAGS,
  },
  outcomes: {
    routes: ["/v1/outcomes"],
    tables: ["analytics_daily"],
  },
  snapshots: {
    routes: ["/v1/admin/snapshots"],
    tables: ["content_snapshots", "content_snapshot_items", "content_snapshot_packs", "content_snapshot_params", "user_snapshot_pins"],
  },
  validator: {
    routes: ["/v1/admin/validator/latest", "/v1/admin/validator/run"],
    tables: ["validator_runs"],
  },
  rollback: {
    routes: ["/v1/admin/snapshots/{snapshotId}/rollback", "/v1/admin/snapshots/"],
    tables: ["content_snapshots"],
  },
  support_replay: {
    routes: ["/v1/admin/support/replay"],
    tables: ["debug_bundles", "user_events"],
  },
};

function tableExists(name) {
  if (!name) return false;
  try {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

async function loadOpenApiPaths() {
  const openapiPath = path.join(process.cwd(), "public", "openapi.v1.json");
  try {
    const raw = await fs.readFile(openapiPath, "utf8");
    const parsed = JSON.parse(raw);
    const paths = parsed?.paths || {};
    return new Set(Object.keys(paths));
  } catch {
    return new Set();
  }
}

async function loadServerRouteText() {
  const serverPath = path.join(process.cwd(), "src", "server", "index.js");
  try {
    return await fs.readFile(serverPath, "utf8");
  } catch {
    return "";
  }
}

function routeExists(route, openapiPaths, serverText) {
  if (!route) return false;
  if (openapiPaths.has(route)) return true;
  if (serverText.includes(route)) return true;
  return false;
}

export async function alphaReadiness() {
  const openapiPaths = await loadOpenApiPaths();
  const serverText = await loadServerRouteText();
  let flags = {};
  try {
    flags = await listFeatureFlags();
  } catch {
    flags = {};
  }

  const missing = [];
  for (const key of ALPHA_REQUIRED) {
    const req = REQUIRED_FEATURES[key] || {};
    const routesOk = (req.routes || []).every((route) => routeExists(route, openapiPaths, serverText));
    const tablesOk = (req.tables || []).every((table) => tableExists(table));
    const flagsOk = (req.flags || []).every((flag) => Object.prototype.hasOwnProperty.call(flags, flag));
    if (!routesOk || !tablesOk || !flagsOk) {
      missing.push(key);
    }
  }

  return { pass: missing.length === 0, missing };
}
