import fs from "fs";
import path from "path";

const ALLOWED_MODES = new Set(["dev", "internal", "alpha", "prod", "test"]);
let cachedConfig = null;

function parseBool(value) {
  if (value == null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseAdminEmails(input) {
  return (input || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function readAdminEmailsFile(dataDir) {
  const filePath = path.join(dataDir, "admin_emails.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getEnvMode() {
  const raw = (process.env.ENV_MODE || "").trim().toLowerCase();
  if (!raw) return "internal";
  if (!ALLOWED_MODES.has(raw)) {
    throw new Error(`ENV_MODE must be one of dev|internal|alpha|prod|test. Received: ${process.env.ENV_MODE}`);
  }
  return raw;
}

export function getConfig() {
  if (cachedConfig) return cachedConfig;

  const envMode = getEnvMode();
  const isDevLike = envMode === "dev" || envMode === "internal" || envMode === "test";
  const isAlphaLike = envMode === "alpha";
  const isProdLike = envMode === "prod";

  const dataDir = process.env.DATA_DIR || "data";
  const envAdmins = parseAdminEmails(process.env.ADMIN_EMAILS);
  const fileAdmins = readAdminEmailsFile(dataDir);
  const adminEmails = new Set([...envAdmins, ...fileAdmins]);

  const devOverride = parseBool(process.env.DEV_ROUTES_ENABLED);
  const devRoutesEnabled = devOverride !== undefined ? devOverride : isDevLike;

  const authOverride = parseBool(process.env.AUTH_REQUIRED);
  const requireAuth = isAlphaLike || isProdLike ? true : authOverride === true;

  const csrfOverride = parseBool(process.env.CSRF_ENABLED);
  const csrfEnabled = isAlphaLike || isProdLike ? true : csrfOverride !== undefined ? csrfOverride : true;

  const rateLimits = {
    userGeneral: 60,
    userMutating: 10,
    ipGeneral: 120,
    authIp: 20,
    authEmail: 5,
    // Back-compat for existing call sites.
    general: 60,
    mutating: 10,
    auth: 5,
  };

  const cacheTTLSeconds = isAlphaLike || isProdLike ? 20 : 10;
  const featureFreeze = process.env.FEATURE_FREEZE === "true";
  const incidentModeDefault = process.env.INCIDENT_MODE === "true";
  const regenThrottleMs = Number(process.env.REGEN_THROTTLE_MS || 2 * 60 * 60 * 1000);
  const adminInDevEnabled = process.env.ADMIN_IN_DEV === "true";
  const rulesFrozenOverride = parseBool(process.env.RULES_FROZEN);
  const rulesFrozen = rulesFrozenOverride !== undefined ? rulesFrozenOverride : isAlphaLike || isProdLike;
  const contentStageMode = process.env.CONTENT_STAGE_MODE === "true";
  const alertWebhookUrl = (process.env.ALERT_WEBHOOK_URL || "").trim();
  const maxP95MsByRoute = {
    "/v1/rail/today": Number(process.env.MAX_P95_RAIL_MS || 300),
    "/v1/plan/day": Number(process.env.MAX_P95_PLAN_DAY_MS || 300),
  };
  const maxErrorRate = Number(process.env.MAX_ERROR_RATE || 0.01);
  const backupWindowHours = Number(process.env.BACKUP_WINDOW_HOURS || 24);
  const planChangeLimit7d = Number(process.env.PLAN_CHANGE_LIMIT_7D || 8);

  const config = {
    envMode,
    isDevLike,
    isAlphaLike,
    isProdLike,
    requireAuth,
    devRoutesEnabled,
    secretKeyPolicy: {
      allowEphemeral: isDevLike,
      requireReal: isAlphaLike || isProdLike,
    },
    rateLimits,
    cacheTTLSeconds,
    csrfEnabled,
    adminEmails,
    featureFreeze,
    incidentModeDefault,
    regenThrottleMs,
    adminInDevEnabled,
    rulesFrozen,
    contentStageMode,
    alertWebhookUrl,
    maxP95MsByRoute,
    maxErrorRate,
    backupWindowHours,
    planChangeLimit7d,
    port: Number(process.env.PORT || 3000),
    dataDir,
    dbStatusRequired: true,
  };

  cachedConfig = Object.freeze(config);
  return cachedConfig;
}
