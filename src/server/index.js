import http from "http";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import * as domain from "../domain/index.js";
import { reduceEvent } from "../state/engine.js";
import { normalizeState, validateState } from "../domain/schema.js";
import { getScenarioById } from "../dev/scenarios.js";
import { runSnapshotCheck, SNAPSHOT_IDS } from "../dev/snapshot.js";
import { toDayContract } from "./dayContract.js";
import { getUserId, sanitizeUserId } from "./userId.js";
import { AppError, badRequest, forbidden, internal, sendError as baseSendError } from "./errors.js";
import { logInfo, logError } from "./logger.js";
import { assertDayContract, assertWeekPlan } from "./invariants.js";
import { validateWorkoutItem, validateResetItem, validateNutritionItem } from "../domain/content/validateContent.js";
import { runContentChecks } from "../domain/content/checks.js";
import { hashJSON, sanitizeContentItem, sanitizePack } from "../domain/content/snapshotHash.js";
import { buildModelStamp } from "../domain/planning/modelStamp.js";
import {
  validateProfile,
  validateCheckIn,
  validateSignal,
  validateFeedback,
  validateComplete,
  validateRules,
  validateReplay,
  validateDateParam,
  validateTimezone,
} from "./validate.js";
import {
  initDb,
  checkDbConnection,
  checkReady,
  getDbPath,
  getUserState,
  saveUserState,
  appendUserEvent,
  getUserEvents,
  getUserEventsRecent,
  listUserEventsPaged,
  getOrCreateUser,
  createAuthCode,
  verifyAuthCode,
  getSession,
  seedContentItems,
  getContentItem,
  listContentItems,
  listContentItemsPaged,
  patchContentItem,
  setContentStatus,
  getContentStatuses,
  upsertContentItem,
  bumpContentStats,
  getContentStats,
  getAdminStats,
  listSessionsByUser,
  touchSession,
  deleteSessionByTokenOrHash,
  updateRefreshTokenDeviceName,
  revokeRefreshTokenById,
  seedParameters,
  listParameters,
  cleanupOldEvents,
  upsertDecisionTrace,
  getDecisionTrace,
  listDecisionTraces,
  listDecisionTracesRecent,
  recordActiveUser,
  updateAnalyticsDaily,
  listAnalyticsDaily,
  getUserStateHistory,
  getWorstItems,
  seedFeatureFlags,
  listFeatureFlags,
  setFeatureFlag,
  upsertParameter,
  listAppliedMigrations,
  listRefreshTokensByUser,
  getUserById,
  recordAuthFailure,
  resetAuthAttempts,
  isAuthLocked,
  insertAdminAudit,
  insertContentValidationReport,
  listContentValidationReports,
  listExperiments,
  getExperiment,
  createExperiment,
  updateExperiment,
  setExperimentStatus,
  listExperimentAssignments,
  insertDebugBundle,
  getDebugBundle,
  searchUserByEmail,
  insertDayPlanHistory,
  listDayPlanHistory,
  getDayPlanHistoryById,
  insertPlanChangeSummary,
  listPlanChangeSummaries,
  insertChangelogEntry,
  listChangelogEntries,
  upsertReminderIntent,
  listReminderIntentsByDate,
  listReminderIntentsByRange,
  updateReminderIntentStatus,
  listReminderIntentsAdmin,
  seedCohorts,
  listCohorts,
  listCohortParameters,
  upsertCohortParameter,
  getUserCohort,
  setUserCohort,
  seedContentPacks,
  listContentPacks,
  getContentPack,
  upsertContentPack,
  listAllUserStates,
  cleanupUserRetention,
  deleteUserData,
  insertValidatorRun,
  getLatestValidatorRun,
  getValidatorRun,
  listValidatorRuns,
  cleanupValidatorRuns,
  upsertUserConsents,
  missingUserConsents,
  listUserConsents,
  setCommunityOptIn,
  getCommunityOptIn,
  insertCommunityResponse,
  listCommunityResponses,
  listCommunityPending,
  moderateCommunityResponse,
  listUserContentPrefs,
  upsertUserContentPref,
  deleteUserContentPref,
  insertContentFeedback,
  createContentSnapshot,
  listContentSnapshots,
  getContentSnapshot,
  updateContentSnapshotStatus,
  getLatestReleasedSnapshot,
  getLatestSnapshotIdForPrefix,
  listContentSnapshotItems,
  listContentSnapshotPacks,
  listContentSnapshotParams,
  getSnapshotMeta,
  upsertSnapshotMeta,
  insertOpsRun,
  getLatestOpsRun,
  insertOpsLog,
  listLatestDayPlanHistoryByRange,
  runWithQueryTracker,
  getQueryStats,
} from "../state/db.js";
import { createBackup, restoreBackup, listBackups } from "../db/backup.js";
import { getConfig } from "./config.js";
import { ensureSecretKey } from "./env.js";
import { computeBootSummary } from "./bootSummary.js";
import { handleSetupRoutes } from "./setupRoutes.js";
import { getParameters, getDefaultParameters, resetParametersCache, validateParamValue } from "./parameters.js";
import { applyExperiments, SAFETY_DENYLIST } from "./experiments.js";
import { createTaskScheduler } from "./tasks.js";
import { createEngineValidator } from "./tasks/engineValidator.js";
import { signAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "../security/tokens.js";
import { diffDayContracts } from "./diff.js";
import { toDateISOWithBoundary, validateTimeZone } from "../domain/utils/time.js";
import { trackEvent, setDailyFlag, ensureDay3Retention, AnalyticsFlags, getFirstFlagDate } from "./analytics.js";
import { buildOutcomes } from "./outcomes.js";
import { runLoadtestScript, evaluateLoadtestReport } from "./ops.js";
import { buildReleaseChecklist } from "./releaseChecklist.js";
import { diffSnapshots } from "./snapshotDiff.js";
import { loadSnapshotBundle, resolveSnapshotForUser, setDefaultSnapshotId, getDefaultSnapshotId, repinUserSnapshot } from "./snapshots.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const config = getConfig();
const PORT = config.port;
const isDevRoutesEnabled = config.devRoutesEnabled;
const EVENT_SOURCING = process.env.EVENT_SOURCING === "true";
const EVENT_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS || 90);
const runtimeAdminEmails = config.adminEmails;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const PUBLIC_DIR = path.join(process.cwd(), "public");
const CITATIONS_PATH = path.join(PUBLIC_DIR, "citations.json");
const REQUIRED_CONTENT_IDS = new Set(["r_panic_mode"]);
const REQUIRED_CONSENTS = ["terms", "privacy", "alpha_processing"];
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const ALL_PROFILES = [
  "Balanced",
  "PoorSleep",
  "WiredOverstimulated",
  "DepletedBurnedOut",
  "RestlessAnxious",
];

let citationsCache = null;
async function loadCitations() {
  if (citationsCache) return citationsCache;
  try {
    const raw = await fs.readFile(CITATIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    citationsCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    citationsCache = [];
  }
  return citationsCache;
}

const userStates = new Map();
const MAX_USERS = 50;
const lastSignalByUser = new Map();
const userRateLimiters = new Map();
const ipRateLimiters = new Map();
let shuttingDown = false;
const authEmailRateLimiters = new Map();
const authIpRateLimiters = new Map();
const readCache = new Map();
const contentPrefsCache = new Map();
const latencySamples = new Map();
const errorCounters = new Map();
const requestCounters = new Map();
const recent5xx = [];
const featureFlagsCache = { data: null, loadedAt: 0 };
const FEATURE_FLAGS_TTL_MS = 10 * 1000;
const ERROR_WINDOW_MS = 60 * 60 * 1000;
const ERROR_WINDOW_LONG_MS = 24 * 60 * 60 * 1000;
const ERROR_SPIKE_WINDOW_MS = 5 * 60 * 1000;
const ERROR_SPIKE_THRESHOLD = 10;
let last5xxAlertAt = 0;
const DEFAULT_FLAGS = {
  "rules.constraints.enabled": "true",
  "rules.novelty.enabled": "true",
  "rules.feedback.enabled": "true",
  "rules.badDay.enabled": "true",
  "rules.recoveryDebt.enabled": "true",
  "rules.circadianAnchors.enabled": "true",
  "rules.safety.enabled": "true",
  "reminders.enabled": "true",
  "feature.freeze.enabled": "false",
  "incident.mode.enabled": "false",
  "engine.regen.enabled": "true",
  "engine.signals.enabled": "true",
  "engine.checkins.enabled": "true",
  "engine.reentry.enabled": "true",
  "community.enabled": "true",
};
const DEFAULT_COHORTS = [
  { id: "new_users", name: "New Users" },
  { id: "high_stress", name: "High Stress" },
  { id: "poor_sleep", name: "Poor Sleep" },
];
const CONTENT_PREFS_TTL_MS = 30 * 1000;
const CACHE_TTLS = {
  railToday: 10 * 1000,
  planDay: 20 * 1000,
  planWeek: 30 * 1000,
  trends: 30 * 1000,
  outcomes: 30 * 1000,
};
const LATENCY_ROUTES = new Set(["GET /v1/plan/day", "GET /v1/rail/today", "POST /v1/checkin", "POST /v1/signal"]);
const ACCESS_TOKEN_TTL_SEC = 15 * 60;

const secretState = ensureSecretKey(config);

await ensureDataDirWritable(config);
await initDb();
validateLibraryContent(domain.defaultLibrary);
await seedContentItems(domain.defaultLibrary);
await seedContentPacks(defaultPackSeeds());
await ensureRequiredContentItems();
await seedFeatureFlags(DEFAULT_FLAGS);
await seedParameters(getDefaultParameters());
await seedCohorts(DEFAULT_COHORTS);
resetParametersCache();
await applyLibraryFromDb();
await cleanupOldEvents(EVENT_RETENTION_DAYS);
const engineValidator = createEngineValidator({
  domain,
  toDayContract,
  assertDayContract,
  getParameters,
  listContentPacks,
  listContentItems,
  validateContentItem,
  logInfo,
});

async function runEngineValidatorTask(options = {}) {
  const report = await engineValidator(options);
  const atISO = report.endedAt || new Date().toISOString();
  await insertValidatorRun({
    id: report.runId,
    kind: "engine_matrix",
    ok: report.ok,
    report,
    atISO,
  });
  await cleanupValidatorRuns("engine_matrix", 30);
  if (!report.ok) {
    void postAlert("validator_failed", {
      kind: "engine_matrix",
      runId: report.runId,
      totals: report.totals,
      failures: (report.failures || []).slice(0, 20),
    });
  }
  return report;
}

const bootSummary = await computeBootSummary(config);
enforceGuardrails(config, bootSummary);
logInfo({ boot: bootSummary });
const taskScheduler = createTaskScheduler({
  config,
  createBackup,
  cleanupOldEvents,
  retentionDays: EVENT_RETENTION_DAYS,
  listAllUserStates,
  cleanupUserRetention,
  runEngineValidator: runEngineValidatorTask,
  cleanupValidatorRuns,
});
taskScheduler.schedule();

function enforceGuardrails(runtimeConfig, summary) {
  if (!(runtimeConfig.isAlphaLike || runtimeConfig.isProdLike)) return;
  const failures = [];
  if (!summary.secretKey.present || summary.secretKey.ephemeral) failures.push("SECRET_KEY");
  if (!summary.admin.configured) failures.push("ADMIN_EMAILS");
  if (summary.devRoutes.enabled) failures.push("DEV_ROUTES_ENABLED");
  if (!summary.csrf.enabled) failures.push("CSRF");
  if (runtimeConfig.requireAuth && !summary.storage.ok) failures.push("DB");
  if (failures.length) {
    throw new Error(
      `ENV_MODE=${runtimeConfig.envMode} requires SECRET_KEY (32+ chars) and ADMIN_EMAILS and CSRF enabled. Refusing to boot.`
    );
  }
}

async function ensureDataDirWritable(runtimeConfig) {
  const dirs = new Set([runtimeConfig.dataDir, path.dirname(getDbPath())]);
  for (const dir of dirs) {
    const testPath = path.join(dir, `.write-test-${process.pid}.tmp`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(testPath, "ok");
      await fs.unlink(testPath);
    } catch (err) {
      logError({ event: "data_dir_write_failed", dir, error: err?.message || String(err) });
      process.exit(1);
    }
  }
}

async function applyLibraryFromDb() {
  const items = await listContentItems(undefined, false, { statuses: ["enabled"] });
  if (!items.length) return;
  const workouts = [];
  const nutrition = [];
  const resets = [];
  const invalid = [];
  items.forEach((item) => {
    const validation = validateContentItem(item.kind, item);
    if (!validation.ok) {
      invalid.push({ id: item.id, kind: item.kind, field: validation.field, message: validation.message });
      return;
    }
    if (item.kind === "workout") workouts.push(item);
    if (item.kind === "nutrition") nutrition.push(item);
    if (item.kind === "reset") resets.push(item);
  });
  if (invalid.length) {
    logError({ event: "invalid_content_items", count: invalid.length, invalid });
    if (config.isAlphaLike || config.isProdLike) {
      throw internal("invalid_content_item", "Invalid content items present");
    }
  }
  if (workouts.length) domain.defaultLibrary.workouts = workouts;
  if (nutrition.length) domain.defaultLibrary.nutrition = nutrition;
  if (resets.length) domain.defaultLibrary.resets = resets;
  if (typeof domain.setLibraryIndex === "function") {
    domain.setLibraryIndex(domain.defaultLibrary);
  }
}

async function ensureRequiredContentItems() {
  const items = await listContentItems(undefined, true);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const reset of domain.defaultLibrary.resets || []) {
    if (!REQUIRED_CONTENT_IDS.has(reset.id)) continue;
    const existing = byId.get(reset.id);
    if (!existing || existing.enabled === false) {
      await upsertContentItem(
        "reset",
        { ...reset, enabled: true },
        { status: "enabled", updatedByAdmin: null }
      );
    }
  }
}

function validateContentItem(kind, item, options = {}) {
  if (kind === "workout") return validateWorkoutItem(item, options);
  if (kind === "reset") return validateResetItem(item, options);
  if (kind === "nutrition") return validateNutritionItem(item, options);
  return { ok: false, field: "kind", message: "kind must be workout, reset, or nutrition" };
}

function validateContentItemOrThrow(kind, item, options = {}) {
  const validation = validateContentItem(kind, item, options);
  if (!validation.ok) {
    throw badRequest("invalid_content_item", validation.message, validation.field);
  }
}

function validateLibraryContent(library) {
  const kinds = [
    { key: "workout", items: library?.workouts || [] },
    { key: "nutrition", items: library?.nutrition || [] },
    { key: "reset", items: library?.resets || [] },
  ];
  const invalid = [];
  kinds.forEach(({ key, items }) => {
    items.forEach((item) => {
      const validation = validateContentItem(key, item);
      if (!validation.ok) invalid.push({ kind: key, id: item?.id, field: validation.field, message: validation.message });
    });
  });
  if (invalid.length) {
    logError({ event: "invalid_seed_content", invalid });
    throw internal("invalid_content_item", "Invalid seed content detected");
  }
}

function defaultPackSeeds() {
  const defaults = getDefaultParameters();
  const weights = defaults.contentPackWeights || {};
  const names = {
    calm_reset: "Calm reset",
    balanced_routine: "Balanced routine",
    rebuild_strength: "Rebuild strength",
  };
  const packs = {};
  Object.keys(names).forEach((id) => {
    packs[id] = {
      name: names[id],
      weights: weights[id] || {},
      constraints: defaults.contentPackConstraints?.[id] || {},
    };
  });
  return packs;
}

function getUserTimezone(profile) {
  const tz = profile?.timezone;
  if (typeof tz !== "string" || !tz.trim()) return DEFAULT_TIMEZONE;
  if (!validateTimeZone(tz)) return DEFAULT_TIMEZONE;
  return tz.trim();
}

function getDayBoundaryHour(profile) {
  const hour = Number(profile?.dayBoundaryHour);
  if (!Number.isFinite(hour)) return 4;
  const clamped = Math.max(0, Math.min(6, Math.floor(hour)));
  return clamped;
}

function getTodayISOForProfile(profile) {
  const tz = getUserTimezone(profile);
  const boundary = getDayBoundaryHour(profile);
  return toDateISOWithBoundary(new Date(), tz, boundary) || domain.isoToday();
}

async function getFeatureFlags() {
  const now = Date.now();
  if (featureFlagsCache.data && now - featureFlagsCache.loadedAt < FEATURE_FLAGS_TTL_MS) {
    return featureFlagsCache.data;
  }
  const loaded = await listFeatureFlags();
  const merged = { ...DEFAULT_FLAGS, ...(loaded || {}) };
  featureFlagsCache.data = merged;
  featureFlagsCache.loadedAt = now;
  return merged;
}

function flagEnabled(flags, key) {
  const value = flags?.[key];
  if (value == null) return true;
  return String(value) !== "false";
}

function flagEnabledDefault(flags, key, defaultValue = false) {
  const value = flags?.[key];
  if (value == null) return defaultValue;
  return String(value) === "true";
}

function resolveFeatureFreeze(flags) {
  const flagValue = flags?.["feature.freeze.enabled"];
  if (flagValue != null) return String(flagValue) === "true";
  return config.featureFreeze === true;
}

function resolveIncidentMode(flags) {
  return flagEnabledDefault(flags, "incident.mode.enabled", false);
}

function resolveEngineGuards(flags, incidentModeEnabled) {
  const incidentMode = Boolean(incidentModeEnabled);
  const guards = {
    incidentMode,
    regenEnabled: !incidentMode && flagEnabled(flags, "engine.regen.enabled"),
    signalsEnabled: !incidentMode && flagEnabled(flags, "engine.signals.enabled"),
    checkinsEnabled: !incidentMode && flagEnabled(flags, "engine.checkins.enabled"),
    reentryEnabled: !incidentMode && flagEnabled(flags, "engine.reentry.enabled"),
    communityEnabled: !incidentMode && flagEnabled(flags, "community.enabled"),
  };
  return guards;
}

function resolveRuleToggles(state, flags) {
  const base = {
    constraintsEnabled: flagEnabled(flags, "rules.constraints.enabled"),
    noveltyEnabled: flagEnabled(flags, "rules.novelty.enabled"),
    feedbackEnabled: flagEnabled(flags, "rules.feedback.enabled"),
    badDayEnabled: flagEnabled(flags, "rules.badDay.enabled"),
    recoveryDebtEnabled: flagEnabled(flags, "rules.recoveryDebt.enabled"),
    circadianAnchorsEnabled: flagEnabled(flags, "rules.circadianAnchors.enabled"),
    safetyEnabled: flagEnabled(flags, "rules.safety.enabled"),
  };
  const allowOverrides = isDevRoutesEnabled && config.isDevLike;
  if (!allowOverrides) return base;
  const overrides = state.ruleToggles || {};
  return {
    constraintsEnabled: base.constraintsEnabled && overrides.constraintsEnabled !== false,
    noveltyEnabled: base.noveltyEnabled && overrides.noveltyEnabled !== false,
    feedbackEnabled: base.feedbackEnabled && overrides.feedbackEnabled !== false,
    badDayEnabled: base.badDayEnabled && overrides.badDayEnabled !== false,
    recoveryDebtEnabled: base.recoveryDebtEnabled && overrides.recoveryDebtEnabled !== false,
    circadianAnchorsEnabled: base.circadianAnchorsEnabled && overrides.circadianAnchorsEnabled !== false,
    safetyEnabled: base.safetyEnabled && overrides.safetyEnabled !== false,
  };
}

function buildRuleConfig(requestId, userId = null) {
  return {
    envMode: config.envMode,
    rulesFrozen: config.rulesFrozen,
    logger: {
      warn(payload) {
        logInfo({ requestId, userId, ...(payload || {}) });
      },
    },
  };
}

const ENABLED_STATUSES = ["enabled"];
const STAGE_STATUSES = ["enabled", "staged"];
const CONTENT_KINDS = new Set(["workout", "nutrition", "reset"]);

function isStageModeRequest(req, url, adminEmail) {
  if (!adminEmail) return false;
  const header = String(req.headers["x-content-stage"] || "").toLowerCase();
  const queryValue = url.searchParams.get("stage");
  return config.contentStageMode || header === "true" || String(queryValue).toLowerCase() === "true";
}

function statusesForScope(scope) {
  const normalized = typeof scope === "string" ? scope.trim().toLowerCase() : "enabled";
  if (normalized === "draft") return ["draft"];
  if (normalized === "staged") return ["staged"];
  if (normalized === "disabled") return ["disabled"];
  if (normalized === "all") return Array.from(getContentStatuses());
  return ["enabled"];
}

async function loadLibraryForStatuses(statuses, { allowInvalid = false } = {}) {
  const items = await listContentItems(undefined, true, { statuses });
  if (!items.length) return null;
  const library = { workouts: [], nutrition: [], resets: [] };
  const invalid = [];
  items.forEach((item) => {
    if (item.enabled === false) return;
    const validation = validateContentItem(item.kind, item);
    if (!validation.ok) {
      invalid.push({ id: item.id, kind: item.kind, field: validation.field, message: validation.message });
      return;
    }
    if (item.kind === "workout") library.workouts.push(item);
    if (item.kind === "nutrition") library.nutrition.push(item);
    if (item.kind === "reset") library.resets.push(item);
  });
  if (invalid.length) {
    logError({ event: "invalid_content_items", count: invalid.length, invalid });
    if (!allowInvalid && (config.isAlphaLike || config.isProdLike)) {
      throw internal("invalid_content_item", "Invalid content items present");
    }
  }
  return library;
}

async function loadLibraryForStageMode(stageMode) {
  const statuses = stageMode ? STAGE_STATUSES : ENABLED_STATUSES;
  return loadLibraryForStatuses(statuses, { allowInvalid: stageMode });
}

function snapshotOverrideFromRequest(req, url) {
  const header = req.headers["x-snapshot-id"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const queryValue = url.searchParams.get("snapshot");
  const raw = headerValue || queryValue;
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > 64 ? null : trimmed;
}

async function resolveSnapshotContext({ userId, userProfile, req, url }) {
  const allowLive = config.isDevLike && !config.isAlphaLike && !config.isProdLike;
  const overrideSnapshotId = allowLive ? snapshotOverrideFromRequest(req, url) : null;
  const snapshotInfo = await resolveSnapshotForUser({
    userId,
    userProfile,
    overrideSnapshotId,
    allowLive,
  });

  if (snapshotInfo.snapshotId) {
    const bundle = await loadSnapshotBundle(snapshotInfo.snapshotId, { userId });
    if (bundle) {
      return {
        snapshotId: snapshotInfo.snapshotId,
        source: snapshotInfo.source,
        pinExpiresAt: snapshotInfo.pinExpiresAt || null,
        snapshot: bundle.snapshot,
        library: bundle.library || domain.defaultLibrary,
        paramsState: bundle.paramsState,
      };
    }
    logError({
      event: "snapshot_load_failed",
      snapshotId: snapshotInfo.snapshotId,
      userId,
    });
  }

  const paramsState = await getParameters(userId);
  return {
    snapshotId: null,
    source: snapshotInfo.source || "live",
    pinExpiresAt: null,
    snapshot: null,
    library: domain.defaultLibrary,
    paramsState,
  };
}

function normalizeContentKind(kind) {
  const key = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  return CONTENT_KINDS.has(key) ? key : null;
}

async function runChecksForItem(kind, id) {
  const statuses = Array.from(getContentStatuses());
  const items = await listContentItems(kind, true, { statuses });
  const report = runContentChecks(items, { kind, scope: "all" });
  const item = items.find((entry) => entry.id === id) || null;
  const errors = report.errors.filter((entry) => entry.id === id);
  const warnings = report.warnings.filter((entry) => entry.id === id);
  return { item, report, errors, warnings };
}

function normalizeExperimentStatus(status) {
  const key = typeof status === "string" ? status.trim().toLowerCase() : "draft";
  if (key === "running" || key === "stopped" || key === "draft") return key;
  return "draft";
}

async function validateExperimentConfig(config, { requirePackIds = true } = {}) {
  if (!config || typeof config !== "object") {
    throw badRequest("invalid_experiment_config", "config_json required", "config_json");
  }
  const type = config.type;
  if (type !== "pack" && type !== "parameters") {
    throw badRequest("invalid_experiment_type", "type must be pack or parameters", "config_json.type");
  }
  const variants = Array.isArray(config.variants) ? config.variants.filter((v) => v && v.key) : [];
  if (variants.length < 2) {
    throw badRequest("invalid_experiment_variants", "At least two variants required", "config_json.variants");
  }
  const seenKeys = new Set();
  variants.forEach((variant) => {
    if (seenKeys.has(variant.key)) {
      throw badRequest("duplicate_experiment_variant", `Duplicate variant key: ${variant.key}`, "config_json.variants");
    }
    seenKeys.add(variant.key);
  });

  if (type === "pack") {
    if (!requirePackIds) return config;
    const packs = await listContentPacks();
    const packIds = new Set(packs.map((pack) => pack.id));
    variants.forEach((variant) => {
      if (!variant.packId || !packIds.has(variant.packId)) {
        throw badRequest("invalid_experiment_pack", `Unknown packId for variant ${variant.key}`, "config_json.variants");
      }
    });
    return config;
  }

  variants.forEach((variant) => {
    const override = variant.paramsOverride;
    if (!override) return;
    const keys = Object.keys(override);
    const blocked = keys.filter((key) => SAFETY_DENYLIST.has(key));
    if (blocked.length) {
      throw badRequest(
        "experiment_guardrail_violation",
        `paramsOverride may not change safety thresholds: ${blocked.join(", ")}`,
        "config_json.variants"
      );
    }
    keys.forEach((key) => {
      if (!validateParamValue(key, override[key])) {
        throw badRequest("invalid_experiment_override", `Invalid paramsOverride for ${key}`, "config_json.variants");
      }
    });
  });
  return config;
}

function addMinutesToTimeStr(timeStr, minutesToAdd) {
  if (!timeStr) return "12:00";
  const [h, m] = timeStr.split(":").map((val) => Number(val));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "12:00";
  let total = h * 60 + m + minutesToAdd;
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function toScheduledISO(dateISO, timeStr) {
  return `${dateISO}T${timeStr}:00.000Z`;
}

function buildReminderSchedule(userProfile, dateISO) {
  if (!userProfile) return [];
  const wake = userProfile.wakeTime || "07:00";
  const bed = userProfile.bedTime || "23:00";
  const sunlightTime = addMinutesToTimeStr(wake, 30);
  const mealTime = userProfile.mealTimingConsistency <= 5 ? addMinutesToTimeStr(wake, 5 * 60) : "12:00";
  const downshiftTime = addMinutesToTimeStr(bed, -90);
  return [
    { intentKey: "sunlight_am", scheduledForISO: toScheduledISO(dateISO, sunlightTime) },
    { intentKey: "meal_midday", scheduledForISO: toScheduledISO(dateISO, mealTime) },
    { intentKey: "downshift_pm", scheduledForISO: toScheduledISO(dateISO, downshiftTime) },
  ];
}

async function upsertDailyReminders(userId, state, dateISO) {
  const schedule = buildReminderSchedule(state.userProfile, dateISO);
  for (const intent of schedule) {
    await upsertReminderIntent({
      userId,
      dateISO,
      intentKey: intent.intentKey,
      scheduledForISO: intent.scheduledForISO,
      status: "scheduled",
    });
  }
}

function cohortForCheckIn(checkIn) {
  if (!checkIn) return "new_users";
  if (Number(checkIn.stress || 0) >= 8) return "high_stress";
  if (Number(checkIn.sleepQuality || 10) <= 4) return "poor_sleep";
  return "new_users";
}

function logRepair(requestId, userId, repaired, method, reason) {
  logInfo({ requestId, userId, event: "repair", repaired, method, reason: reason || null });
}

async function repairUserState(userId, reason, requestId = null, options = {}) {
  const baseNow = new Date().toISOString();
  const paramsStateOverride = options.paramsState || null;
  const libraryOverride = options.library || null;
  const modelStampOverride = options.modelStamp || null;
  const events = await getUserEvents(userId, 1, 5000);
  if (events.length) {
    const flags = await getFeatureFlags();
    const paramsState = paramsStateOverride || (await getParameters(userId));
    const ruleConfig = buildRuleConfig(requestId, userId);
    let experimentEffects = {
      paramsEffective: paramsState.map,
      packOverride: null,
      experimentMeta: null,
      assignments: [],
    };
    try {
      experimentEffects = await applyExperiments({
        userId,
        cohortId: paramsState.cohortId || null,
        params: paramsState.map,
        logger: ruleConfig.logger,
      });
    } catch (err) {
      logError({
        event: "experiments_apply_failed",
        userId,
        requestId,
        error: err?.code || err?.message || String(err),
      });
    }
    const paramsMeta = {
      cohortId: paramsState.cohortId || null,
      versions: paramsState.versionsBySource || {},
      experiments: experimentEffects.assignments || [],
    };
    const paramsEffective = experimentEffects.paramsEffective || paramsState.map;
    const packOverride = experimentEffects.packOverride || null;
    const experimentMeta = experimentEffects.experimentMeta || null;
    const modelStamp = modelStampOverride || null;
    let rebuilt = normalizeState({});
    for (const evt of events) {
      const todayISO = getTodayISOForProfile(rebuilt.userProfile);
      const ctx = {
        domain,
        now: { todayISO, atISO: evt.atISO || baseNow },
        ruleToggles: resolveRuleToggles(rebuilt, flags),
        scenarios: { getScenarioById },
        isDev: isDevRoutesEnabled,
        params: paramsEffective,
        paramsMeta,
        packOverride,
        experimentMeta,
        ruleConfig,
        library: libraryOverride || domain.defaultLibrary,
        modelStamp,
      };
      const result = reduceEvent(rebuilt, { type: evt.type, payload: evt.payload, atISO: evt.atISO || baseNow }, ctx);
      rebuilt = appendLogEvent(result.nextState, result.logEvent);
    }
    try {
      validateState(rebuilt);
      const latest = await getUserState(userId);
      const saveRes = await saveUserState(userId, latest?.version || 0, rebuilt);
      if (saveRes.ok) {
        updateUserCache(userId, rebuilt, saveRes.version);
        logRepair(requestId, userId, true, "replay", reason || "events_replay");
        return { repaired: true, method: "replay", state: rebuilt };
      }
    } catch {
      // fallthrough to history
    }
  }

  const history = await getUserStateHistory(userId, 50);
  for (const entry of history) {
    try {
      validateState(entry.state);
      const latest = await getUserState(userId);
      const saveRes = await saveUserState(userId, latest?.version || 0, entry.state);
      if (saveRes.ok) {
        updateUserCache(userId, entry.state, saveRes.version);
        logRepair(requestId, userId, true, "history", reason || "history_fallback");
        return { repaired: true, method: "history", state: entry.state };
      }
    } catch {
      // continue
    }
  }

  const latest = await getUserState(userId);
  const base = normalizeState(latest?.state || {});
  if (base.userProfile) {
    const flags = await getFeatureFlags();
    const paramsState = paramsStateOverride || (await getParameters(userId));
    const ruleConfig = buildRuleConfig(requestId, userId);
    let experimentEffects = {
      paramsEffective: paramsState.map,
      packOverride: null,
      experimentMeta: null,
      assignments: [],
    };
    try {
      experimentEffects = await applyExperiments({
        userId,
        cohortId: paramsState.cohortId || null,
        params: paramsState.map,
        logger: ruleConfig.logger,
      });
    } catch (err) {
      logError({
        event: "experiments_apply_failed",
        userId,
        requestId,
        error: err?.code || err?.message || String(err),
      });
    }
    const paramsMeta = {
      cohortId: paramsState.cohortId || null,
      versions: paramsState.versionsBySource || {},
      experiments: experimentEffects.assignments || [],
    };
    const paramsEffective = experimentEffects.paramsEffective || paramsState.map;
    const packOverride = experimentEffects.packOverride || null;
    const experimentMeta = experimentEffects.experimentMeta || null;
    const modelStamp = modelStampOverride || null;
    const resetState = normalizeState({
      ...base,
      weekPlan: null,
      lastStressStateByDate: {},
      selectionStats: { workouts: {}, nutrition: {}, resets: {} },
    });
    const ctx = {
      domain,
      now: { todayISO: getTodayISOForProfile(resetState.userProfile), atISO: baseNow },
      ruleToggles: resolveRuleToggles(resetState, flags),
      scenarios: { getScenarioById },
      isDev: isDevRoutesEnabled,
      params: paramsEffective,
      paramsMeta,
      packOverride,
      experimentMeta,
      ruleConfig,
      library: libraryOverride || domain.defaultLibrary,
      modelStamp,
    };
    try {
      const ensured = reduceEvent(resetState, { type: "ENSURE_WEEK", payload: {}, atISO: baseNow }, ctx);
      const next = appendLogEvent(ensured.nextState, ensured.logEvent);
      validateState(next);
      const saveRes = await saveUserState(userId, latest?.version || 0, next);
      if (saveRes.ok) {
        updateUserCache(userId, next, saveRes.version);
        logRepair(requestId, userId, true, "reset", reason || "reset");
        return { repaired: true, method: "reset", state: next };
      }
    } catch {
      // fallthrough
    }
  }

  logRepair(requestId, userId, false, null, reason || "repair_failed");
  return { repaired: false, method: null, state: null };
}

function evictIfNeeded() {
  if (userStates.size <= MAX_USERS) return;
  let oldestKey = null;
  let oldestAt = Infinity;
  for (const [key, value] of userStates.entries()) {
    if (value.lastAccessAt < oldestAt) {
      oldestAt = value.lastAccessAt;
      oldestKey = key;
    }
  }
  if (oldestKey) userStates.delete(oldestKey);
}

async function loadUserState(userId) {
  const cached = userStates.get(userId);
  if (cached) {
    cached.lastAccessAt = Date.now();
    return cached;
  }
  const snapshot = await getUserState(userId);
  const state = normalizeState(snapshot?.state || {});
  try {
    validateState(state);
  } catch (err) {
    const repaired = await repairUserState(userId, "invalid_snapshot");
    if (repaired.repaired) {
      const latest = await getUserState(userId);
      const entry = { state: repaired.state, version: latest?.version || 0, lastAccessAt: Date.now() };
      userStates.set(userId, entry);
      evictIfNeeded();
      return entry;
    }
    throw err;
  }
  const version = snapshot?.version ?? 0;
  const entry = { state, version, lastAccessAt: Date.now() };
  userStates.set(userId, entry);
  evictIfNeeded();
  return entry;
}

function updateUserCache(userId, state, version) {
  userStates.set(userId, { state, version, lastAccessAt: Date.now() });
  evictIfNeeded();
}

async function repairAndReload(userId, reason, requestId, options = {}) {
  const repaired = await repairUserState(userId, reason, requestId, options);
  if (!repaired.repaired) return null;
  return loadUserState(userId);
}

async function ensureValidDayContract(userId, state, dateISO, reason, requestId, options = {}) {
  try {
    const day = toDayContract(state, dateISO, domain);
    assertDayContract(day);
    return { state, day };
  } catch (err) {
    const repairedEntry = await repairAndReload(userId, reason, requestId, options);
    if (repairedEntry) {
      const day = toDayContract(repairedEntry.state, dateISO, domain);
      assertDayContract(day);
      return { state: repairedEntry.state, day };
    }
    throw internal("invalid_day_contract", "Unable to produce a valid day plan", "day");
  }
}

async function ensureValidWeekPlan(userId, state, reason, requestId) {
  try {
    assertWeekPlan(state.weekPlan);
    return { state, weekPlan: state.weekPlan };
  } catch (err) {
    const repairedEntry = await repairAndReload(userId, reason, requestId);
    if (repairedEntry) {
      assertWeekPlan(repairedEntry.state.weekPlan);
      return { state: repairedEntry.state, weekPlan: repairedEntry.state.weekPlan };
    }
    throw internal("invalid_week_plan", "Unable to produce a valid week plan", "weekPlan");
  }
}

function selectionSignature(dayPlan) {
  if (!dayPlan) return "";
  const selected = dayPlan.meta?.selected || {};
  const workoutId = selected.workoutId || dayPlan.workout?.id || "";
  const resetId = selected.resetId || dayPlan.reset?.id || "";
  const nutritionId = selected.nutritionId || dayPlan.nutrition?.id || "";
  return `${workoutId}|${resetId}|${nutritionId}`;
}

function selectionChangedForDate(prevState, nextState, dateISO) {
  if (!dateISO) return false;
  const prevDay = prevState.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
  const nextDay = nextState.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
  return selectionSignature(prevDay) !== selectionSignature(nextDay);
}

function getEventDatesForThrottle(prevState, eventWithAt) {
  const dates = new Set();
  const type = eventWithAt.type;
  if (type === "CHECKIN_SAVED") {
    const dateISO = eventWithAt.payload?.checkIn?.dateISO;
    if (dateISO) dates.add(dateISO);
    const checkIn = eventWithAt.payload?.checkIn;
    if (checkIn?.dateISO && checkIn.stress >= 7 && checkIn.sleepQuality <= 5) {
      dates.add(domain.addDaysISO(checkIn.dateISO, 1));
    }
  } else if (type === "QUICK_SIGNAL" || type === "BAD_DAY_MODE" || type === "FORCE_REFRESH") {
    const dateISO = eventWithAt.payload?.dateISO;
    if (dateISO) dates.add(dateISO);
  }
  return dates;
}

function isWithinThrottleWindow(lastAtISO, atISO) {
  if (!lastAtISO || !atISO) return false;
  const lastMs = Date.parse(lastAtISO);
  const nowMs = Date.parse(atISO);
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastMs < config.regenThrottleMs;
}

function buildRegenPolicy(prevState, eventWithAt, nextState) {
  const forced = eventWithAt.payload?.forced === true;
  if (forced) return null;
  const dates = getEventDatesForThrottle(prevState, eventWithAt);
  if (!dates.size) return null;
  const lastRegen = prevState.regenWindow?.lastRegenAtISOByDate || {};
  const lockSelectionsByDate = {};
  dates.forEach((dateISO) => {
    if (!dateISO) return;
    if (!selectionChangedForDate(prevState, nextState, dateISO)) return;
    const lastAt = lastRegen[dateISO];
    if (isWithinThrottleWindow(lastAt, eventWithAt.atISO)) {
      lockSelectionsByDate[dateISO] = true;
    }
  });
  if (!Object.keys(lockSelectionsByDate).length) return null;
  return { lockSelectionsByDate, reason: "regen_throttle" };
}

const PLAN_MUTATION_EVENTS = new Set([
  "ENSURE_WEEK",
  "WEEK_REBUILD",
  "CHECKIN_SAVED",
  "QUICK_SIGNAL",
  "BAD_DAY_MODE",
  "FORCE_REFRESH",
]);

function revertPlanState(prevState, nextState) {
  return {
    ...nextState,
    weekPlan: prevState.weekPlan,
    lastStressStateByDate: prevState.lastStressStateByDate,
    selectionStats: prevState.selectionStats,
    history: prevState.history,
    modifiers: prevState.modifiers,
    regenWindow: prevState.regenWindow,
  };
}

function applyPlanGuards(prevState, nextState, eventType, guards, requestId, userId) {
  if (!PLAN_MUTATION_EVENTS.has(eventType)) return nextState;
  const policy = guards || {};
  let reason = null;
  if (policy.incidentMode) {
    reason = "incident_mode";
  } else if (policy.regenEnabled === false) {
    reason = "regen_disabled";
  } else if (eventType === "CHECKIN_SAVED" && policy.checkinsEnabled === false) {
    reason = "checkins_disabled";
  } else if (eventType === "QUICK_SIGNAL" && policy.signalsEnabled === false) {
    reason = "signals_disabled";
  }
  if (!reason) return nextState;
  logInfo({ requestId, userId, event: "engine_guard_blocked", reason, eventType });
  return revertPlanState(prevState, nextState);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeConstraintsPayload(constraints) {
  const injuries = constraints?.injuries || {};
  const equipment = constraints?.equipment || {};
  const timePrefRaw =
    typeof constraints?.timeOfDayPreference === "string" ? constraints.timeOfDayPreference.trim().toLowerCase() : "any";
  const timeOfDayPreference = ["morning", "midday", "evening", "any"].includes(timePrefRaw) ? timePrefRaw : "any";
  const normalizedInjuries = {
    knee: Boolean(injuries.knee),
    shoulder: Boolean(injuries.shoulder),
    back: Boolean(injuries.back),
  };
  const normalizedEquipment = {
    none: equipment.none !== false,
    dumbbells: Boolean(equipment.dumbbells),
    bands: Boolean(equipment.bands),
    gym: Boolean(equipment.gym),
  };
  if (!normalizedEquipment.none && !normalizedEquipment.dumbbells && !normalizedEquipment.bands && !normalizedEquipment.gym) {
    normalizedEquipment.none = true;
  }
  return { injuries: normalizedInjuries, equipment: normalizedEquipment, timeOfDayPreference };
}

function normalizeUserProfile(profile) {
  if (!profile) return null;
  const dataMin = profile.dataMinimization || {};
  const timezone = getUserTimezone(profile);
  const dayBoundaryHour = getDayBoundaryHour(profile);
  const createdAtISO = profile.createdAtISO || toDateISOWithBoundary(new Date(), timezone, dayBoundaryHour) || domain.isoToday();
  const constraints = normalizeConstraintsPayload(profile.constraints || {});
  return {
    ...profile,
    id: profile.id || Math.random().toString(36).slice(2),
    createdAtISO,
    wakeTime: profile.wakeTime || "07:00",
    bedTime: profile.bedTime || "23:00",
    sleepRegularity: toNumber(profile.sleepRegularity, 5),
    caffeineCupsPerDay: toNumber(profile.caffeineCupsPerDay, 1),
    lateCaffeineDaysPerWeek: toNumber(profile.lateCaffeineDaysPerWeek, 1),
    sunlightMinutesPerDay: toNumber(profile.sunlightMinutesPerDay, 10),
    lateScreenMinutesPerNight: toNumber(profile.lateScreenMinutesPerNight, 45),
    alcoholNightsPerWeek: toNumber(profile.alcoholNightsPerWeek, 1),
    mealTimingConsistency: toNumber(profile.mealTimingConsistency, 5),
    preferredWorkoutWindows: Array.isArray(profile.preferredWorkoutWindows) ? profile.preferredWorkoutWindows : ["PM"],
    busyDays: Array.isArray(profile.busyDays) ? profile.busyDays : [],
    contentPack: profile.contentPack || "balanced_routine",
    timezone,
    dayBoundaryHour,
    constraints,
    dataMinimization: (() => {
      const enabled = Boolean(dataMin.enabled);
      const eventDays = Number.isFinite(Number(dataMin.eventRetentionDays)) ? Number(dataMin.eventRetentionDays) : 90;
      const historyDays = Number.isFinite(Number(dataMin.historyRetentionDays)) ? Number(dataMin.historyRetentionDays) : 90;
      const cap = enabled ? 30 : 365;
      return {
        enabled,
        storeNotes: dataMin.storeNotes !== false,
        storeTraces: dataMin.storeTraces !== false,
        eventRetentionDays: Math.min(eventDays, cap),
        historyRetentionDays: Math.min(historyDays, cap),
      };
    })(),
  };
}

function applyDataMinimizationToCheckIn(checkIn, userProfile) {
  if (!checkIn) return checkIn;
  const dataMin = userProfile?.dataMinimization;
  if (!dataMin?.enabled) return checkIn;
  if (dataMin.storeNotes === false) {
    const { notes, ...rest } = checkIn;
    return { ...rest };
  }
  return checkIn;
}

async function ensureRequiredConsents(userId, res) {
  if (!userId) return true;
  const missing = await missingUserConsents(userId, REQUIRED_CONSENTS);
  if (!missing.length) return true;
  sendError(
    res,
    forbidden("consent_required", "Consent required before accessing plans", null, {
      required: missing,
      expose: true,
    })
  );
  return false;
}

function daysBetweenISO(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const start = new Date(`${startISO}T00:00:00Z`).getTime();
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

async function seedInitialProfile(email, profile) {
  const normalized = normalizeUserProfile(profile);
  if (!normalized) return;
  const user = await getOrCreateUser(email);
  let cached = await loadUserState(user.id);
  let currentState = cached.state;
  let currentVersion = cached.version;
  const flags = await getFeatureFlags();
  const effectiveToggles = resolveRuleToggles(currentState, flags);
  const paramsState = await getParameters(user.id);
  const paramsMeta = { cohortId: paramsState.cohortId || null, versions: paramsState.versionsBySource || {} };

  const baseline = dispatch(
    currentState,
    { type: "BASELINE_SAVED", payload: { userProfile: normalized } },
    { ruleToggles: effectiveToggles, params: paramsState.map, paramsMeta }
  );
  currentState = baseline.state;
  const ensured = dispatch(
    currentState,
    { type: "ENSURE_WEEK", payload: {} },
    { ruleToggles: effectiveToggles, params: paramsState.map, paramsMeta }
  );
  currentState = ensured.state;

  let saveRes = await saveUserState(user.id, currentVersion, currentState);
  if (!saveRes.ok) {
    cached = await loadUserState(user.id);
    currentState = cached.state;
    currentVersion = cached.version;
    const retryBaseline = dispatch(
      currentState,
      { type: "BASELINE_SAVED", payload: { userProfile: normalized } },
      { ruleToggles: effectiveToggles, params: paramsState.map, paramsMeta }
    );
    currentState = retryBaseline.state;
    const retryEnsured = dispatch(
      currentState,
      { type: "ENSURE_WEEK", payload: {} },
      { ruleToggles: effectiveToggles, params: paramsState.map, paramsMeta }
    );
    currentState = retryEnsured.state;
    saveRes = await saveUserState(user.id, currentVersion, currentState);
  }
  if (saveRes.ok) {
    updateUserCache(user.id, currentState, saveRes.version);
  }
}

function appendLogEvent(current, logEvent) {
  if (!logEvent) return current;
  const entries = Array.isArray(logEvent) ? logEvent : [logEvent];
  let nextLog = current.eventLog || [];
  entries.forEach((entry) => {
    if (!entry) return;
    nextLog = [
      {
        id: Math.random().toString(36).slice(2),
        atISO: entry.atISO || new Date().toISOString(),
        type: entry.type,
        payload: entry.payload,
      },
      ...nextLog,
    ].slice(0, 500);
  });
  return { ...current, eventLog: nextLog };
}

function dispatch(state, event, ctxOverrides = {}) {
  const todayISO = getTodayISOForProfile(state.userProfile);
  const ruleConfig = ctxOverrides.ruleConfig || buildRuleConfig(ctxOverrides.requestId || null, state.userProfile?.id || null);
  const ctx = {
    domain,
    ruleToggles: ctxOverrides.ruleToggles || state.ruleToggles,
    now: { todayISO, atISO: new Date().toISOString() },
    scenarios: { getScenarioById },
    isDev: isDevRoutesEnabled,
    params: ctxOverrides.params,
    paramsMeta: ctxOverrides.paramsMeta,
    ruleConfig,
    ...ctxOverrides,
  };

  const { nextState, effects, logEvent, result } = reduceEvent(state, event, ctx);
  const next = appendLogEvent(nextState, logEvent);
  return { state: next, result, logEvent, effects };
}

function attachDbStats(res) {
  const stats = getQueryStats();
  if (!stats) return;
  res.livenewDbStats = stats;
  const shouldExpose = config.isDevLike || res.livenewIsAdmin;
  if (!shouldExpose) return;
  res.livenewExtraHeaders = {
    ...(res.livenewExtraHeaders || {}),
    "x-db-queries": String(stats.count ?? 0),
    "x-db-ms": String(Math.round(stats.totalMs ?? 0)),
  };
}

function sendError(res, errOrStatus, code, message, field) {
  attachDbStats(res);
  baseSendError(res, errOrStatus, code, message, field, res?.livenewRequestId);
}

function sendJson(res, status, payload, userId) {
  const body = userId ? { userId, ...payload } : { ...payload };
  if (res?.livenewRequestId) body.requestId = res.livenewRequestId;
  attachDbStats(res);
  const headers = { "Content-Type": "application/json", ...(res?.livenewExtraHeaders || {}) };
  if (res?.livenewApiVersion) headers["x-api-version"] = res.livenewApiVersion;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function parseJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  chunks.forEach((chunk) => {
    total += chunk.length;
  });
  if (total > 200 * 1024) {
    throw new AppError("payload_too_large", "Payload too large", 413, "body");
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("bad_json", "Invalid JSON body", "body");
  }
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isWeightMap(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).every(([key, weight]) => typeof key === "string" && Number.isFinite(Number(weight)));
}

function validatePackWeightsShape(weights) {
  if (!weights || typeof weights !== "object") return false;
  const fields = ["workoutTagWeights", "resetTagWeights", "nutritionTagWeights"];
  return fields.every((field) => isWeightMap(weights[field] || {}));
}

function parseMaybeJson(value, fieldName) {
  if (value == null) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") {
    throw badRequest("field_invalid", `${fieldName} must be object or JSON string`, fieldName);
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw badRequest("field_invalid", `${fieldName} must be valid JSON`, fieldName);
  }
}

function cleanOutlineLine(line) {
  return String(line || "")
    .trim()
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function shortHash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 8);
}

function deriveTags({ kind, title, steps, suggestedTags }) {
  const tags = new Set();
  (suggestedTags || []).forEach((tag) => {
    if (typeof tag === "string" && tag.trim()) tags.add(tag.trim().toLowerCase());
  });
  const haystack = `${title || ""} ${Array.isArray(steps) ? steps.join(" ") : ""}`.toLowerCase();
  const keywordTags = [
    ["breath", "breath"],
    ["breathe", "breath"],
    ["walk", "walk"],
    ["mobility", "mobility"],
    ["stretch", "mobility"],
    ["yoga", "mobility"],
    ["strength", "strength"],
    ["weights", "strength"],
    ["lift", "strength"],
    ["run", "cardio"],
    ["sprint", "cardio"],
    ["hiit", "cardio"],
    ["calm", "downshift"],
    ["downshift", "downshift"],
    ["rebuild", "rebuild"],
    ["stabilize", "stabilize"],
    ["focus", "focus"],
  ];
  keywordTags.forEach(([needle, tag]) => {
    if (haystack.includes(needle)) tags.add(tag);
  });
  if (kind === "reset") tags.add("downshift");
  if (kind !== "nutrition" && (steps?.length || 0) <= 3) tags.add("short");
  if (!tags.size) tags.add("general");
  return Array.from(tags);
}

function estimateMinutes(kind, steps, minutesHint) {
  const count = Array.isArray(steps) ? steps.length : 1;
  const hint = Number(minutesHint);
  if (Number.isFinite(hint) && hint > 0) {
    if (kind === "reset") return Math.min(Math.max(hint, 2), 5);
    if (kind === "workout") return Math.min(Math.max(hint, 10), 30);
  }
  if (kind === "reset") {
    return Math.min(5, Math.max(2, 2 + Math.floor(count / 2)));
  }
  if (kind === "workout") {
    return Math.min(30, Math.max(10, 10 + count * 2));
  }
  return null;
}

function estimateIntensity(title, steps) {
  const text = `${title || ""} ${Array.isArray(steps) ? steps.join(" ") : ""}`.toLowerCase();
  const high = ["hiit", "sprint", "burpee", "interval"];
  const low = ["breath", "mobility", "stretch", "yoga", "walk"];
  const moderate = ["strength", "lift", "run", "cardio"];
  if (high.some((k) => text.includes(k))) return 8;
  if (low.some((k) => text.includes(k))) return 3;
  if (moderate.some((k) => text.includes(k))) return 6;
  return 5;
}

function outlineToContentItem({ kind, outlineText, suggestedTags, minutesHint }) {
  const lines = String(outlineText || "")
    .split(/\r?\n/)
    .map(cleanOutlineLine)
    .filter(Boolean);
  const title = lines[0] || "Untitled";
  const stepsOrPriorities = lines.slice(1);
  const baseSteps = stepsOrPriorities.length ? stepsOrPriorities : [title];
  const tags = deriveTags({ kind, title, steps: baseSteps, suggestedTags });
  const id = `${kind}_${slugify(title) || "item"}_${shortHash(outlineText)}`;
  if (kind === "nutrition") {
    return {
      id,
      kind,
      title,
      tags,
      priorities: baseSteps,
      enabled: false,
      status: "draft",
    };
  }
  if (kind === "reset") {
    return {
      id,
      kind,
      title,
      tags,
      minutes: estimateMinutes(kind, baseSteps, minutesHint),
      steps: baseSteps,
      intensityCost: 0,
      enabled: false,
      status: "draft",
    };
  }
  return {
    id,
    kind,
    title,
    tags,
    minutes: estimateMinutes(kind, baseSteps, minutesHint),
    steps: baseSteps,
    intensityCost: estimateIntensity(title, baseSteps),
    enabled: false,
    status: "draft",
  };
}

function sanitizeCommunityText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.slice(0, 400);
}

function redactSensitive(value, depth = 0) {
  if (depth > 6) return value;
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, depth + 1));
  if (typeof value !== "object") return value;
  const blockedKeys = ["email", "token", "refresh", "authorization", "notes", "headers"];
  const next = {};
  Object.entries(value).forEach(([key, entry]) => {
    const lower = String(key).toLowerCase();
    if (blockedKeys.some((blocked) => lower.includes(blocked))) return;
    next[key] = redactSensitive(entry, depth + 1);
  });
  return next;
}

function numericCheckIn(checkIn) {
  if (!checkIn) return null;
  const fields = ["stress", "sleepQuality", "energy", "timeAvailableMin", "illness", "injury", "panic", "fever"];
  const result = {
    dateISO: checkIn.dateISO || null,
    atISO: checkIn.atISO || null,
  };
  fields.forEach((field) => {
    if (field in checkIn) result[field] = checkIn[field];
  });
  return result;
}

function summarizeDayContract(day) {
  if (!day) return null;
  return {
    dateISO: day.dateISO,
    profile: day.why?.profile || null,
    focus: day.why?.focus || null,
    workoutId: day.what?.workout?.id || null,
    resetId: day.what?.reset?.id || null,
    nutritionId: day.what?.nutrition?.id || null,
    totalMinutes: day.howLong?.totalMinutes ?? null,
    appliedRules: (day.why?.expanded?.appliedRules || []).slice(0, 5),
    driversTop2: day.why?.driversTop2 || [],
  };
}

function dateISOForAt(profile, atISO) {
  const tz = getUserTimezone(profile);
  const boundary = getDayBoundaryHour(profile);
  const date = atISO ? new Date(atISO) : new Date();
  return toDateISOWithBoundary(date, tz, boundary) || domain.isoToday();
}

function qualityRulesFromToggles(toggles) {
  const rules = toggles || {};
  return {
    avoidNoveltyWindowDays: rules.noveltyEnabled === false ? 0 : 2,
    noveltyEnabled: rules.noveltyEnabled !== false,
    constraintsEnabled: rules.constraintsEnabled !== false,
    recoveryDebtEnabled: rules.recoveryDebtEnabled !== false,
    circadianAnchorsEnabled: rules.circadianAnchorsEnabled !== false,
    safetyEnabled: rules.safetyEnabled !== false,
  };
}

async function ensureWeekForDate(state, dateISO, dispatchFn) {
  if (!state.userProfile) return state;
  if (!state.weekPlan) {
    const res = await dispatchFn({ type: "ENSURE_WEEK", payload: {} });
    state = res.state;
    if (!state.weekPlan || !dateISO) return state;
  }
  if (dateISO && !state.weekPlan.days.some((d) => d.dateISO === dateISO)) {
    const res = await dispatchFn({ type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO } });
    return res.state;
  }
  return (await dispatchFn({ type: "ENSURE_WEEK", payload: {} })).state;
}

function resetSort(a, b) {
  const priorityDiff = Number(b?.priority || 0) - Number(a?.priority || 0);
  if (priorityDiff) return priorityDiff;
  const minutesDiff = Number(a?.minutes || 0) - Number(b?.minutes || 0);
  if (minutesDiff) return minutesDiff;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function pickRailReset({ dayPlan, checkIn, library, preferences }) {
  const lib = library || domain.defaultLibrary;
  const resets = Array.isArray(lib?.resets) ? lib.resets : [];
  const enabled = resets.filter((item) => item && item.enabled !== false);
  if (!enabled.length) return null;
  const filtered = preferences?.avoids?.size
    ? enabled.filter((item) => !preferences.avoids.has(item.id))
    : enabled;
  const poolBase = filtered.length ? filtered : enabled;
  const panicActive = Boolean(checkIn?.panic || dayPlan?.safety?.reasons?.includes?.("panic"));
  if (panicActive) {
    const panicReset = poolBase.find((item) => item.id === "r_panic_mode") || enabled.find((item) => item.id === "r_panic_mode");
    if (panicReset) return panicReset;
  }
  const twoMinute = poolBase.filter((item) => Number(item.minutes || 0) <= 2);
  const pool = twoMinute.length ? twoMinute : poolBase;
  const tagged = pool.filter((item) => Array.isArray(item.tags) && item.tags.some((tag) => tag === "downshift" || tag === "breathe"));
  const favorites = preferences?.favorites || null;
  const ranked = (tagged.length ? tagged : pool).slice().sort((a, b) => {
    const favA = favorites?.has?.(a.id) ? 1 : 0;
    const favB = favorites?.has?.(b.id) ? 1 : 0;
    if (favA !== favB) return favB - favA;
    return resetSort(a, b);
  });
  return ranked[0] || enabled[0];
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function applyCors(req, res) {
  if (!ALLOWED_ORIGINS.length) return false;
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Device-Name, X-Request-Id, X-Client-Type, X-CSRF-Token"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  return true;
}

function summarizeLibraryItems(items) {
  return (items || []).map((item) => ({
    id: item.id,
    title: item.title,
    tags: item.tags,
    priority: item.priority,
    noveltyGroup: item.noveltyGroup,
  }));
}

function getRequestId(req) {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && String(value).trim() ? String(value).trim() : crypto.randomUUID();
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

function getDeviceName(req) {
  const header = req.headers["x-device-name"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
}

function isAuthRequired() {
  return config.requireAuth;
}

function parseAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

function isAdmin(email) {
  if (!email) return false;
  return runtimeAdminEmails.has(email.toLowerCase());
}

function addAdminEmail(email) {
  if (!email) return;
  runtimeAdminEmails.add(email.toLowerCase());
}

function isAdminConfigured() {
  return runtimeAdminEmails.size > 0;
}

function getBucket(map, key, capacity) {
  if (!map.has(key)) {
    map.set(key, { tokens: capacity, last: Date.now() });
  }
  return map.get(key);
}

function takeToken(bucket, capacity, refillPerMs) {
  const now = Date.now();
  const elapsed = now - bucket.last;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function checkIpRateLimit(ip) {
  const capacity = config.rateLimits.ipGeneral;
  const bucket = getBucket(ipRateLimiters, ip || "unknown", capacity);
  const ok = takeToken(bucket, capacity, capacity / 60000);
  return { ok, kind: "ip" };
}

function getUserLimiter(userId) {
  if (!userRateLimiters.has(userId)) {
    const general = config.rateLimits.userGeneral;
    const mutating = config.rateLimits.userMutating;
    userRateLimiters.set(userId, {
      general: { tokens: general, last: Date.now() },
      mutating: { tokens: mutating, last: Date.now() },
    });
  }
  return userRateLimiters.get(userId);
}

function checkUserRateLimit(userId, isMutating) {
  const limiter = getUserLimiter(userId);
  const generalCap = config.rateLimits.userGeneral;
  const mutatingCap = config.rateLimits.userMutating;
  const okGeneral = takeToken(limiter.general, generalCap, generalCap / 60000);
  if (!okGeneral) return { ok: false, kind: "user_general" };
  if (isMutating) {
    const okMutating = takeToken(limiter.mutating, mutatingCap, mutatingCap / 60000);
    if (!okMutating) return { ok: false, kind: "user_mutating" };
  }
  return { ok: true };
}

function recordLatency(routeKey, ms) {
  if (!LATENCY_ROUTES.has(routeKey)) return;
  const list = latencySamples.get(routeKey) || [];
  list.push(ms);
  if (list.length > 500) list.shift();
  latencySamples.set(routeKey, list);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 10) / 10;
}

function latencyStats(routeKey) {
  const samples = latencySamples.get(routeKey) || [];
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

async function postAlert(type, payload = {}) {
  const alert = {
    type,
    atISO: new Date().toISOString(),
    envMode: config.envMode,
    ...payload,
  };
  if (!config.alertWebhookUrl) {
    logInfo({ event: "alert", alert });
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
    });
    if (!res.ok) {
      logError({ event: "alert_failed", status: res.status, type });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logError({ event: "alert_failed", type, error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err) };
  }
}

function pruneWindow(timestamps, cutoff) {
  if (!timestamps.length) return timestamps;
  return timestamps.filter((ts) => ts >= cutoff);
}

function record5xx(nowMs) {
  const cutoff = nowMs - ERROR_SPIKE_WINDOW_MS;
  const pruned = pruneWindow(recent5xx, cutoff);
  recent5xx.length = 0;
  recent5xx.push(...pruned, nowMs);
  if (recent5xx.length < ERROR_SPIKE_THRESHOLD) return;
  if (nowMs - last5xxAlertAt < ERROR_SPIKE_WINDOW_MS) return;
  last5xxAlertAt = nowMs;
  void postAlert("5xx_spike", {
    count: recent5xx.length,
    windowMinutes: Math.round(ERROR_SPIKE_WINDOW_MS / 60000),
  });
}

function recordErrorCounter({ routeKey, code, status }) {
  if (!routeKey || status < 400) return;
  const nowMs = Date.now();
  const cutoff = nowMs - ERROR_WINDOW_LONG_MS;
  const key = `${code || "error"}::${routeKey}`;
  const existing = errorCounters.get(key) || { code: code || "error", routeKey, timestamps: [], lastSeenAtISO: null };
  existing.timestamps = pruneWindow(existing.timestamps, cutoff);
  existing.timestamps.push(nowMs);
  existing.lastSeenAtISO = new Date(nowMs).toISOString();
  errorCounters.set(key, existing);
  if (status >= 500) {
    record5xx(nowMs);
  }
}

function snapshotErrorCounters(limit = 50) {
  const nowMs = Date.now();
  const cutoff = nowMs - ERROR_WINDOW_MS;
  const entries = [];
  for (const entry of errorCounters.values()) {
    const timestamps = pruneWindow(entry.timestamps || [], cutoff);
    if (!timestamps.length) continue;
    const lastSeenAtISO = new Date(timestamps[timestamps.length - 1]).toISOString();
    entries.push({
      code: entry.code,
      routeKey: entry.routeKey,
      count: timestamps.length,
      lastSeenAtISO,
    });
  }
  entries.sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)));
  return entries.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

function recordRequestCounter(routeKey, status) {
  if (!routeKey) return;
  const nowMs = Date.now();
  const cutoff = nowMs - ERROR_WINDOW_LONG_MS;
  const entry = requestCounters.get(routeKey) || { routeKey, timestamps: [] };
  entry.timestamps = pruneWindow(entry.timestamps, cutoff);
  entry.timestamps.push(nowMs);
  requestCounters.set(routeKey, entry);
}

function snapshotRequestCounts(windowMs = ERROR_WINDOW_LONG_MS) {
  const nowMs = Date.now();
  const cutoff = nowMs - windowMs;
  let total = 0;
  for (const entry of requestCounters.values()) {
    const timestamps = pruneWindow(entry.timestamps || [], cutoff);
    entry.timestamps = timestamps;
    total += timestamps.length;
  }
  return { total, windowMinutes: Math.round(windowMs / 60000) };
}

function diffSelectionStats(prevStats, nextStats) {
  const diffs = [];
  const categories = ["workouts", "nutrition", "resets"];
  categories.forEach((category) => {
    const prevCat = prevStats?.[category] || {};
    const nextCat = nextStats?.[category] || {};
    const ids = new Set([...Object.keys(prevCat), ...Object.keys(nextCat)]);
    ids.forEach((id) => {
      const prev = prevCat[id] || { picked: 0, completed: 0, notRelevant: 0 };
      const next = nextCat[id] || { picked: 0, completed: 0, notRelevant: 0 };
      const fields = ["picked", "completed", "notRelevant"];
      fields.forEach((field) => {
        const delta = (next[field] || 0) - (prev[field] || 0);
        if (delta > 0) {
          diffs.push({ itemId: id, field, delta });
        }
      });
    });
  });
  return diffs;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies = {};
  pairs.forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function issueCsrfToken(res) {
  const token = crypto.randomBytes(16).toString("hex");
  if (isDevRoutesEnabled) {
    const cookie = `csrf=${token}; HttpOnly; SameSite=Strict; Path=/`;
    res.setHeader("Set-Cookie", cookie);
  }
  return token;
}

function getCsrfToken(req) {
  const cookies = parseCookies(req);
  return cookies.csrf || null;
}

function isApiBypassAllowed(req) {
  const clientType = req.headers["x-client-type"];
  return clientType === "api";
}

function requireCsrf(req, res) {
  if (!config.csrfEnabled) return true;
  const method = req.method || "GET";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const authHeader = parseAuthToken(req);
  if (authHeader) return true;
  if (isApiBypassAllowed(req)) return true;
  const hasCookieHeader = Boolean(req.headers.cookie);
  if (!hasCookieHeader) return true;
  const csrfCookie = getCsrfToken(req);
  const csrfHeader = req.headers["x-csrf-token"];
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    sendError(res, 403, "csrf_required", "CSRF token missing or invalid");
    return false;
  }
  return true;
}

function authLimiterKey(type, value) {
  return `${type}:${value || "unknown"}`;
}

function getAuthEmailLimiter(key) {
  const capacity = config.rateLimits.authEmail;
  return getBucket(authEmailRateLimiters, key, capacity);
}

function checkAuthEmailRateLimit(key) {
  const capacity = config.rateLimits.authEmail;
  const limiter = getAuthEmailLimiter(key);
  const ok = takeToken(limiter, capacity, capacity / 60000);
  return ok;
}

function getAuthIpLimiter(key) {
  const capacity = config.rateLimits.authIp;
  return getBucket(authIpRateLimiters, key, capacity);
}

function checkAuthIpRateLimit(key) {
  const capacity = config.rateLimits.authIp;
  const limiter = getAuthIpLimiter(key);
  return takeToken(limiter, capacity, capacity / 60000);
}

function readCacheKey(userId, reqPath, query) {
  return `${userId || "anon"}:${reqPath}?${query || ""}`;
}

function getCachedResponse(userId, reqPath, query) {
  const key = readCacheKey(userId, reqPath, query);
  const entry = readCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    readCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCachedResponse(userId, reqPath, query, payload, ttlMs = config.cacheTTLSeconds * 1000) {
  const key = readCacheKey(userId, reqPath, query);
  readCache.set(key, { payload, expiresAt: Date.now() + ttlMs });
}

function invalidateUserCache(userId) {
  const prefix = `${userId || "anon"}:`;
  for (const key of readCache.keys()) {
    if (key.startsWith(prefix)) readCache.delete(key);
  }
}

async function loadContentPrefs(userId) {
  if (!userId) return { favorites: new Set(), avoids: new Set(), list: [] };
  const cached = contentPrefsCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.loadedAt < CONTENT_PREFS_TTL_MS) return cached.prefs;
  const list = await listUserContentPrefs(userId);
  const favorites = new Set();
  const avoids = new Set();
  list.forEach((entry) => {
    if (entry.pref === "favorite") favorites.add(entry.itemId);
    if (entry.pref === "avoid") avoids.add(entry.itemId);
  });
  const prefs = { favorites, avoids, list };
  contentPrefsCache.set(userId, { prefs, loadedAt: now });
  return prefs;
}

function invalidateContentPrefs(userId) {
  if (userId) contentPrefsCache.delete(userId);
}

function latestCheckInForDate(checkIns, dateISO) {
  if (!Array.isArray(checkIns)) return null;
  let latest = null;
  checkIns.forEach((entry) => {
    if (entry?.dateISO !== dateISO) return;
    if (!latest) {
      latest = entry;
      return;
    }
    const prevAt = latest.atISO || "";
    const nextAt = entry.atISO || "";
    if (!prevAt || nextAt >= prevAt) latest = entry;
  });
  return latest;
}

function buildDecisionTrace(state, dateISO) {
  const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO);
  if (!dayPlan) return null;
  const checkIn = latestCheckInForDate(state.checkIns, dateISO);
  const inputs = {
    checkIn: checkIn
      ? {
          stress: checkIn.stress,
          sleepQuality: checkIn.sleepQuality,
          energy: checkIn.energy,
          timeAvailableMin: checkIn.timeAvailableMin,
        }
      : null,
    modifiers: state.modifiers || {},
    busyDay: Boolean(state.userProfile?.busyDays?.includes?.(dateISO)),
    recoveryDebt: state.lastStressStateByDate?.[dateISO]?.recoveryDebt ?? null,
  };
  return {
    pipelineVersion: dayPlan.pipelineVersion ?? null,
    inputs,
    stressState: state.lastStressStateByDate?.[dateISO] || {},
    selected: dayPlan.meta?.selected || {},
    appliedRules: dayPlan.meta?.appliedRules || [],
    rationale: (dayPlan.rationale || []).slice(0, 3),
    modelStamp: dayPlan.meta?.modelStamp || null,
  };
}

function findChangedDates(prevState, nextState) {
  const prevDays = prevState.weekPlan?.days || [];
  const nextDays = nextState.weekPlan?.days || [];
  const map = new Map();
  prevDays.forEach((day) => map.set(day.dateISO, JSON.stringify(day)));
  const changed = [];
  nextDays.forEach((day) => {
    const prev = map.get(day.dateISO);
    const next = JSON.stringify(day);
    if (prev !== next) changed.push(day.dateISO);
  });
  return changed;
}

function historyCauseForEvent(eventType) {
  switch (eventType) {
    case "ENSURE_WEEK":
      return "week_generated";
    case "WEEK_REBUILD":
      return "week_rebuild";
    case "CHECKIN_SAVED":
      return "checkin_saved";
    case "QUICK_SIGNAL":
      return "quick_signal";
    case "BAD_DAY_MODE":
      return "bad_day";
    case "FEEDBACK_SUBMITTED":
      return "feedback";
    case "APPLY_SCENARIO":
      return "scenario";
    case "BASELINE_SAVED":
      return "baseline_saved";
    default:
      return "update";
  }
}

function shortChangeSummary(flags) {
  const parts = [];
  if (flags.workout) parts.push("workout");
  if (flags.reset) parts.push("reset");
  if (flags.nutrition) parts.push("nutrition");
  if (flags.anchors) parts.push("anchors");
  if (!parts.length) return "Plan updated.";
  const joined = parts.join(", ");
  return `Updated ${joined}.`;
}

function nextActionForPlan(dayPlan) {
  const safetyLevel = dayPlan?.safety?.level;
  if (safetyLevel === "block") return "Use the reset now; keep movement gentle today.";
  const focus = dayPlan?.focus || "stabilize";
  if (focus === "downshift") return "Do the reset first; movement is optional.";
  if (focus === "rebuild") return "Use the planned dose; stop early if stress rises.";
  return "Keep it steady: short movement + consistent meal timing.";
}

function buildChangeSummary({ fromDay, toDay, dayPlan, drivers }) {
  const flags = { workout: false, reset: false, nutrition: false, anchors: false };
  if (!fromDay && toDay) {
    flags.workout = Boolean(toDay.what?.workout);
    flags.reset = Boolean(toDay.what?.reset);
    flags.nutrition = Boolean(toDay.what?.nutrition);
    flags.anchors = Boolean(toDay.details?.anchors);
  } else if (fromDay && toDay) {
    const diff = diffDayContracts(fromDay, toDay);
    diff.changes.forEach((change) => {
      if (change.path.startsWith("what.workout") || change.path.startsWith("details.workoutSteps")) flags.workout = true;
      if (change.path.startsWith("what.reset") || change.path.startsWith("details.resetSteps")) flags.reset = true;
      if (change.path.startsWith("what.nutrition") || change.path.startsWith("details.nutritionPriorities")) flags.nutrition = true;
      if (change.path.startsWith("details.anchors")) flags.anchors = true;
    });
  }

  return {
    whatChanged: flags,
    why: {
      driversTop2: (drivers || []).slice(0, 2),
      appliedRules: dayPlan?.meta?.appliedRules || [],
      safetyLevel: dayPlan?.safety?.level || "ok",
    },
    nextAction: nextActionForPlan(dayPlan),
    short: shortChangeSummary(flags).slice(0, 120),
  };
}

function buildTrends(state, days, todayISO = domain.isoToday()) {
  const result = [];
  const checkIns = Array.isArray(state.checkIns) ? state.checkIns : [];
  const dayMap = new Map();
  checkIns.forEach((item) => {
    if (!dayMap.has(item.dateISO)) dayMap.set(item.dateISO, []);
    dayMap.get(item.dateISO).push(item);
  });

  for (let i = days - 1; i >= 0; i -= 1) {
    const dateISO = domain.addDaysISO(todayISO, -i);
    const items = dayMap.get(dateISO) || [];
    const stressAvg = items.length
      ? items.reduce((sum, item) => sum + Number(item.stress || 0), 0) / items.length
      : null;
    const sleepAvg = items.length
      ? items.reduce((sum, item) => sum + Number(item.sleepQuality || 0), 0) / items.length
      : null;
    const energyAvg = items.length
      ? items.reduce((sum, item) => sum + Number(item.energy || 0), 0) / items.length
      : null;
    const parts = state.partCompletionByDate?.[dateISO] || {};
    const hasCompletion = Object.keys(parts).length > 0;
    const anyPart = hasCompletion ? Boolean(parts.workout || parts.reset || parts.nutrition) : null;
    const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO);
    const downshiftMinutes = dayPlan
      ? dayPlan.focus === "downshift"
        ? (dayPlan.workout?.minutes || 0) + (dayPlan.reset?.minutes || 0)
        : 0
      : null;

    result.push({
      dateISO,
      stressAvg,
      sleepAvg,
      energyAvg,
      anyPart,
      anyPartCompletion: anyPart,
      downshiftMinutes,
    });
  }
  return result;
}

function buildContentStatsMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    map.set(row.itemId, {
      picked: row.picked || 0,
      completed: row.completed || 0,
      notRelevant: row.notRelevant || 0,
    });
  });
  return map;
}

function enrichContentItems(items, statsMap) {
  return (items || []).map((item) => {
    const stat = statsMap.get(item.id) || { picked: 0, completed: 0, notRelevant: 0 };
    const picked = stat.picked || 0;
    const completionRate = picked ? stat.completed / picked : 0;
    const notRelevantRate = picked ? stat.notRelevant / picked : 0;
    return {
      item,
      stats: {
        picked,
        completed: stat.completed || 0,
        notRelevant: stat.notRelevant || 0,
        completionRate,
        notRelevantRate,
      },
    };
  });
}

function sortWorstItems(list) {
  return list.slice().sort((a, b) => {
    if (b.stats.notRelevantRate !== a.stats.notRelevantRate) return b.stats.notRelevantRate - a.stats.notRelevantRate;
    if (a.stats.completionRate !== b.stats.completionRate) return a.stats.completionRate - b.stats.completionRate;
    return (b.stats.picked || 0) - (a.stats.picked || 0);
  });
}

function sortTopItems(list) {
  return list.slice().sort((a, b) => {
    if (b.stats.completionRate !== a.stats.completionRate) return b.stats.completionRate - a.stats.completionRate;
    if (a.stats.notRelevantRate !== b.stats.notRelevantRate) return a.stats.notRelevantRate - b.stats.notRelevantRate;
    return (b.stats.picked || 0) - (a.stats.picked || 0);
  });
}

function buildTagSuggestions(items) {
  const tagStats = new Map();
  items.forEach((entry) => {
    const tags = Array.isArray(entry.item.tags) ? entry.item.tags : [];
    tags.forEach((tag) => {
      const current = tagStats.get(tag) || { picked: 0, completed: 0 };
      tagStats.set(tag, {
        picked: current.picked + (entry.stats.picked || 0),
        completed: current.completed + (entry.stats.completed || 0),
      });
    });
  });
  const scored = Array.from(tagStats.entries()).map(([tag, stats]) => {
    const rate = stats.picked ? stats.completed / stats.picked : 0;
    return { tag, picked: stats.picked, completionRate: rate };
  });
  return scored
    .filter((entry) => entry.picked >= 5)
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5);
}

function buildPackStats(packWeights, itemsByKind, statsMap) {
  if (!packWeights || typeof packWeights !== "object") return {};
  const packs = Object.keys(packWeights);
  const result = {};
  packs.forEach((packId) => {
    const pack = packWeights[packId] || {};
    let picked = 0;
    let completed = 0;
    let notRelevant = 0;
    const kinds = [
      { key: "workout", weights: pack.workoutTagWeights },
      { key: "nutrition", weights: pack.nutritionTagWeights },
      { key: "reset", weights: pack.resetTagWeights },
    ];
    kinds.forEach((kind) => {
      const items = itemsByKind[kind.key] || [];
      items.forEach((item) => {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const matches = tags.some((tag) => Number(kind.weights?.[tag] || 0) > 0);
        if (!matches) return;
        const stats = statsMap.get(item.id) || { picked: 0, completed: 0, notRelevant: 0 };
        picked += stats.picked || 0;
        completed += stats.completed || 0;
        notRelevant += stats.notRelevant || 0;
      });
    });
    result[packId] = {
      picked,
      completed,
      notRelevant,
      completionRate: picked ? completed / picked : 0,
      notRelevantRate: picked ? notRelevant / picked : 0,
    };
  });
  return result;
}

function assessReadiness(runtimeConfig, summary, checks = {}) {
  const failures = [];
  if (runtimeConfig.dbStatusRequired && !summary.storage.ok) failures.push("db");
  if (!summary.dataDir.writable) failures.push("dataDir");
  if (runtimeConfig.secretKeyPolicy.requireReal && summary.secretKey.ephemeral) failures.push("secretKey");
  if (checks.migrationsOk === false) failures.push("migrations");
  if (checks.flagsOk === false) failures.push("featureFlags");
  if (checks.paramsOk === false) failures.push("parameters");
  if (checks.packsOk === false) failures.push("packs");
  if (checks.contentOk === false) failures.push("content");
  if (checks.dbReadyOk === false) failures.push("dbReady");
  if (runtimeConfig.isAlphaLike || runtimeConfig.isProdLike) {
    if (!summary.admin.configured) failures.push("adminEmails");
    if (summary.devRoutes.enabled) failures.push("devRoutes");
    if (!summary.csrf.enabled) failures.push("csrf");
  }
  return { ok: failures.length === 0, failures };
}

function defaultDateRange(days) {
  const toISO = domain.isoToday();
  const fromISO = domain.addDaysISO(toISO, -(days - 1));
  return { fromISO, toISO };
}

function latestUpdatedAt(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  return entries.reduce((latest, entry) => {
    if (!entry?.updatedAt) return latest;
    if (!latest || entry.updatedAt > latest) return entry.updatedAt;
    return latest;
  }, null);
}

function backupIdToISO(id) {
  if (!id) return null;
  const match = String(id).match(/^db\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.bak$/);
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  return `${date}T${hh}:${mm}:${ss}.${ms}Z`;
}

async function summarizeBackups() {
  const backups = await listBackups();
  const latestId = backups[0] || null;
  const latestAtISO = backupIdToISO(latestId);
  return {
    latestAtISO,
    countLast14: Math.min(backups.length, 14),
  };
}

async function computeReleaseChecklistState() {
  const applied = await listAppliedMigrations();
  const migrationFiles = (await fs.readdir(path.join(process.cwd(), "src", "db", "migrations"))).filter(
    (name) => name.endsWith(".sql") && !name.endsWith(".down.sql")
  );
  const expectedIds = migrationFiles
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
  const expectedCount = expectedIds.length;
  const latestExpected = expectedIds[expectedIds.length - 1] || null;
  const latestApplied = applied[applied.length - 1]?.id || null;
  const migrationsApplied = applied.length >= expectedCount && latestApplied === latestExpected;

  const validator = await getLatestValidatorRun("engine_matrix");
  const loadtestRun = await getLatestOpsRun("loadtest");
  const loadtestEval = loadtestRun
    ? evaluateLoadtestReport(loadtestRun.report, { maxP95MsByRoute: config.maxP95MsByRoute, maxErrorRate: config.maxErrorRate })
    : { ok: false, p95ByRoute: {}, errorRate: null };

  const errorCount = countErrors(ERROR_WINDOW_LONG_MS);
  const requestSnapshot = snapshotRequestCounts(ERROR_WINDOW_LONG_MS);
  const errorRate = requestSnapshot.total > 0 ? errorCount / requestSnapshot.total : 0;
  const errorRateOk = errorRate <= config.maxErrorRate;

  const backups = await summarizeBackups();
  const backupWindowMs = Math.max(1, Number(config.backupWindowHours) || 24) * 60 * 60 * 1000;
  const latestBackupMs = backups.latestAtISO ? new Date(backups.latestAtISO).getTime() : 0;
  const backupsOk = Boolean(backups.countLast14) && latestBackupMs && Date.now() - latestBackupMs <= backupWindowMs && backups.countLast14 <= 14;

  const flags = await getFeatureFlags();
  const incidentMode = resolveIncidentMode(flags);
  const guards = resolveEngineGuards(flags, incidentMode);
  const flagsOk =
    !incidentMode &&
    guards.regenEnabled &&
    guards.signalsEnabled &&
    guards.checkinsEnabled &&
    guards.reentryEnabled &&
    guards.communityEnabled;

  const consentFlowOk = ["terms", "privacy", "alpha_processing"].every((key) => REQUIRED_CONSENTS.includes(key));

  const checklist = buildReleaseChecklist({
    migrationsApplied: {
      pass: migrationsApplied,
      details: {
        appliedCount: applied.length,
        expectedCount,
        schemaVersion: latestApplied,
        expectedVersion: latestExpected,
      },
    },
    validatorOk: {
      pass: validator ? validator.ok : false,
      details: { latestRunId: validator?.id || null, latestAtISO: validator?.atISO || null },
    },
    loadtestOk: {
      pass: loadtestRun ? loadtestRun.ok && loadtestEval.ok : false,
      details: { latestAtISO: loadtestRun?.atISO || null, p95ByRoute: loadtestEval.p95ByRoute, errorRate: loadtestEval.errorRate },
    },
    errorRateOk: {
      pass: errorRateOk,
      details: { errorRate, windowMinutes: requestSnapshot.windowMinutes, totalRequests: requestSnapshot.total },
    },
    backupsOk: {
      pass: backupsOk,
      details: { latestAtISO: backups.latestAtISO, countLast14: backups.countLast14 },
    },
    flagsOk: {
      pass: flagsOk,
      details: {
        incidentMode,
        regenEnabled: guards.regenEnabled,
        signalsEnabled: guards.signalsEnabled,
        checkinsEnabled: guards.checkinsEnabled,
        reentryEnabled: guards.reentryEnabled,
        communityEnabled: guards.communityEnabled,
      },
    },
    consentFlowOk: {
      pass: consentFlowOk,
      details: { required: REQUIRED_CONSENTS },
    },
  });

  return {
    checklist,
    validator,
    loadtestRun,
    loadtestEval,
    backups,
    requestSnapshot,
    errorRate,
    errorRateOk,
  };
}

function snapshotIdPrefix(date = new Date()) {
  const dateISO = date.toISOString().slice(0, 10).replace(/-/g, "_");
  return `snap_${dateISO}_`;
}

async function createSnapshotId() {
  const prefix = snapshotIdPrefix(new Date());
  const latest = await getLatestSnapshotIdForPrefix(prefix);
  const match = latest ? latest.match(/_(\d{3})$/) : null;
  const nextSeq = match ? Number(match[1]) + 1 : 1;
  const seq = String(Math.max(1, nextSeq)).padStart(3, "0");
  return `${prefix}${seq}`;
}

function normalizeSnapshotItems(items) {
  const enabled = (items || []).filter((item) => item && item.enabled !== false);
  const normalized = enabled.map((item) => ({
    kind: item.kind,
    itemId: item.id,
    item: sanitizeContentItem(item),
  }));
  normalized.sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.itemId).localeCompare(String(b.itemId)));
  return normalized;
}

function normalizeSnapshotPacks(packs) {
  const normalized = (packs || []).map((pack) => ({
    packId: pack.id,
    pack: sanitizePack({
      id: pack.id,
      name: pack.name,
      weights: pack.weights || {},
      constraints: pack.constraints || {},
    }),
  }));
  normalized.sort((a, b) => String(a.packId).localeCompare(String(b.packId)));
  return normalized;
}

function normalizeSnapshotParams(params) {
  const normalized = (params || []).map((param) => ({
    key: param.key,
    value: param.value,
    version: Number(param.version) || 0,
  }));
  normalized.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return normalized;
}

function computeSnapshotHashes({ items, packs, params }) {
  const itemsPayload = items.map((entry) => ({ kind: entry.kind, itemId: entry.itemId, item: entry.item }));
  const packsPayload = packs.map((entry) => ({ packId: entry.packId, pack: entry.pack }));
  const paramsPayload = params.map((entry) => ({ key: entry.key, value: entry.value, version: entry.version }));
  const packsHash = hashJSON(packsPayload);
  const paramsHash = hashJSON(paramsPayload);
  const libraryHash = hashJSON({ items: itemsPayload, packs: packsPayload, params: paramsPayload });
  return { libraryHash, packsHash, paramsHash };
}

function countErrors(windowMs = ERROR_WINDOW_LONG_MS) {
  const nowMs = Date.now();
  const cutoff = nowMs - windowMs;
  let total = 0;
  for (const entry of errorCounters.values()) {
    const timestamps = pruneWindow(entry.timestamps || [], cutoff);
    entry.timestamps = timestamps;
    total += timestamps.length;
  }
  return total;
}

async function serveFile(res, filePath, { replaceDevFlag } = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const body = replaceDevFlag ? raw.replace("__IS_DEV__", isDevRoutesEnabled ? "true" : "false") : raw;
    res.writeHead(200, { "Content-Type": contentTypeForPath(filePath) });
    res.end(body);
  } catch (err) {
    sendJson(res, 404, { ok: false, error: "not_found" });
  }
}

const server = http.createServer(async (req, res) => {
  return runWithQueryTracker(async () => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const routeKey = `${req.method} ${pathname}`;
  const requestId = getRequestId(req);
  const started = process.hrtime.bigint();
  const clientIp = getClientIp(req);
  res.livenewRequestId = requestId;
  res.livenewClientIp = clientIp;
  res.livenewRouteKey = routeKey;
  if (pathname.startsWith("/v1")) {
    res.livenewApiVersion = "1";
  }
  const corsApplied = applyCors(req, res);
  if (req.method === "OPTIONS") {
    if (corsApplied) {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    recordLatency(routeKey, durationMs);
    recordRequestCounter(routeKey, res.statusCode);
    if (res.statusCode >= 400) {
      const code =
        res.errorCode ||
        (res.statusCode >= 500 ? "server_error" : `http_${res.statusCode}`);
      recordErrorCounter({ routeKey, code, status: res.statusCode });
    }
    const logEntry = {
      atISO: new Date().toISOString(),
      requestId,
      userId: res.livenewUserId || null,
      route: pathname,
      method: req.method,
      status: res.statusCode,
      ms: Math.round(durationMs),
      errorCode: res.errorCode || undefined,
      dbQueries: res.livenewDbStats?.count ?? undefined,
      dbMs: res.livenewDbStats?.totalMs ?? undefined,
    };
    logInfo(logEntry);
  });

  if (shuttingDown) {
    sendError(res, 503, "server_shutting_down", "Server shutting down");
    return;
  }

  const pageRoutes = new Map([
    ["/", "day.html"],
    ["/index.html", "index.html"],
    ["/day", "day.html"],
    ["/day.html", "day.html"],
    ["/week", "week.html"],
    ["/week.html", "week.html"],
    ["/trends", "trends.html"],
    ["/trends.html", "trends.html"],
    ["/profile", "profile.html"],
    ["/profile.html", "profile.html"],
    ["/admin", "admin.html"],
    ["/admin.html", "admin.html"],
    ["/legal/privacy", "legal/privacy.html"],
    ["/legal/privacy.html", "legal/privacy.html"],
    ["/legal/terms", "legal/terms.html"],
    ["/legal/terms.html", "legal/terms.html"],
    ["/legal/alpha-data-processing", "legal/alpha-data-processing.html"],
    ["/legal/alpha-data-processing.html", "legal/alpha-data-processing.html"],
  ]);

  if (req.method === "GET" && pageRoutes.has(pathname)) {
    issueCsrfToken(res);
    await serveFile(res, path.join(PUBLIC_DIR, pageRoutes.get(pathname)));
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/assets/")) {
    await serveFile(res, path.join(PUBLIC_DIR, pathname.slice(1)));
    return;
  }

  if (req.method === "GET" && pathname === "/app.js") {
    await serveFile(res, path.join(PUBLIC_DIR, "assets", "app.core.js"));
    return;
  }

  if (req.method === "GET" && pathname === "/styles.css") {
    await serveFile(res, path.join(PUBLIC_DIR, "assets", "styles.css"));
    return;
  }

  if (req.method === "GET" && pathname === "/openapi.v1.json") {
    await serveFile(res, path.join(PUBLIC_DIR, "openapi.v1.json"));
    return;
  }

  if (pathname.startsWith("/dev") || pathname.startsWith("/api") || pathname.startsWith("/v0")) {
    sendError(res, 410, "route_deprecated", "This route is deprecated. Use /v1.");
    return;
  }

  if (pathname.startsWith("/v1") && pathname !== "/healthz" && pathname !== "/readyz") {
    const ipCheck = checkIpRateLimit(clientIp);
    if (!ipCheck.ok) {
      sendError(res, 429, "rate_limited_ip", "Too many requests");
      return;
    }
  }

  try {
    const handledSetup = await handleSetupRoutes(req, res, config, {
      url,
      sendJson,
      sendError,
      computeSummary: () => computeBootSummary(config),
      isAdminConfigured,
      addAdminEmail,
      seedInitialProfile,
    });
    if (handledSetup) return;

    if (pathname === "/healthz" && req.method === "GET") {
      await checkDbConnection();
      sendJson(res, 200, {
        ok: true,
        versions: {
          pipelineVersion: domain.DECISION_PIPELINE_VERSION ?? null,
          schemaVersion: domain.STATE_SCHEMA_VERSION ?? null,
        },
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    if (pathname === "/readyz" && req.method === "GET") {
      let flagsOk = true;
      let paramsOk = true;
      let migrationsOk = true;
      let dbReadyOk = true;
      let packsOk = true;
      let contentOk = true;
      let migrationsCount = 0;
      try {
        await checkReady();
      } catch {
        dbReadyOk = false;
      }
      try {
        await getFeatureFlags();
      } catch {
        flagsOk = false;
      }
      let paramsState = null;
      try {
        paramsState = await getParameters();
        paramsOk = paramsState.ok;
      } catch {
        paramsOk = false;
      }
      try {
        const packs = await listContentPacks();
        packsOk = packs.length > 0;
      } catch {
        packsOk = false;
      }
      try {
        const [workouts, nutrition, resets] = await Promise.all([
          listContentItems("workout", true, { statuses: ["enabled"] }),
          listContentItems("nutrition", true, { statuses: ["enabled"] }),
          listContentItems("reset", true, { statuses: ["enabled"] }),
        ]);
        if (!workouts.length || !nutrition.length || !resets.length) {
          contentOk = false;
        }
        workouts.forEach((item) => validateContentItemOrThrow("workout", item));
        nutrition.forEach((item) => validateContentItemOrThrow("nutrition", item));
        resets.forEach((item) => validateContentItemOrThrow("reset", item));
      } catch {
        contentOk = false;
      }
      try {
        const migrations = await listAppliedMigrations();
        migrationsCount = migrations.length;
        migrationsOk = migrations.length > 0;
      } catch {
        migrationsOk = false;
      }
      const summary = await computeBootSummary(config);
      const readiness = assessReadiness(config, summary, {
        flagsOk,
        paramsOk,
        migrationsOk,
        dbReadyOk,
        packsOk,
        contentOk,
      });
      sendJson(res, 200, {
        ok: readiness.ok,
        summary,
        failures: readiness.failures,
        checks: {
          flagsOk,
          paramsOk,
          migrationsOk,
          dbReadyOk,
          packsOk,
          contentOk,
          migrationsCount,
        },
      });
      return;
    }

    if (pathname === "/v1/citations" && req.method === "GET") {
      const citations = await loadCitations();
      sendJson(res, 200, { ok: true, citations });
      return;
    }

    if (pathname === "/v1/csrf" && req.method === "GET") {
      if (!isDevRoutesEnabled) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      const token = issueCsrfToken(res);
      sendJson(res, 200, { ok: true, token });
      return;
    }

    if (pathname === "/v1/auth/request" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const email = body?.email;
      if (!email || typeof email !== "string") {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      const emailKey = email.toLowerCase();
      if (!checkAuthIpRateLimit(authLimiterKey("ip", clientIp))) {
        sendError(res, 429, "rate_limited_auth", "Too many auth attempts");
        return;
      }
      if (!checkAuthEmailRateLimit(authLimiterKey("email", emailKey))) {
        sendError(res, 429, "rate_limited_auth", "Too many auth attempts");
        return;
      }
      const user = await getOrCreateUser(emailKey);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await createAuthCode(user.id, user.email, code, expiresAt);
      res.livenewUserId = user.id;
      if (isDevRoutesEnabled) {
        sendJson(res, 200, { ok: true, code }, user.id);
      } else {
        logInfo({
          atISO: new Date().toISOString(),
          event: "auth_code_issued",
          userId: user.id,
        });
        sendJson(res, 200, { ok: true }, user.id);
      }
      return;
    }

    if (pathname === "/v1/auth/verify" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const email = body?.email;
      const code = body?.code;
      if (!email || typeof email !== "string") {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      if (!code || typeof code !== "string") {
        sendError(res, 400, "code_required", "code is required", "code");
        return;
      }
      const emailKey = email.toLowerCase();
      if (!checkAuthIpRateLimit(authLimiterKey("ip", clientIp))) {
        sendError(res, 429, "rate_limited_auth", "Too many auth attempts");
        return;
      }
      if (!checkAuthEmailRateLimit(authLimiterKey("email", emailKey))) {
        sendError(res, 429, "rate_limited_auth", "Too many auth attempts");
        return;
      }
      const lockStatus = await isAuthLocked(emailKey);
      if (lockStatus.locked) {
        sendError(res, 429, "auth_locked", "Too many attempts. Try again later.");
        return;
      }
      const verified = await verifyAuthCode(emailKey, code);
      if (!verified) {
        await recordAuthFailure(emailKey, clientIp);
        sendError(res, 401, "code_invalid", "code is invalid or expired", "code");
        return;
      }
      await resetAuthAttempts(emailKey);
      const deviceName = getDeviceName(req);
      const refresh = await issueRefreshToken({ userId: verified.userId, deviceName });
      const accessToken = signAccessToken({
        userId: verified.userId,
        scope: "user",
        ttlSec: ACCESS_TOKEN_TTL_SEC,
        sessionId: refresh.refreshTokenId,
      });
      res.livenewUserId = verified.userId;
      sendJson(
        res,
        200,
        {
          ok: true,
          accessToken,
          refreshToken: refresh.refreshToken,
          expiresInSec: ACCESS_TOKEN_TTL_SEC,
          token: accessToken,
        },
        verified.userId
      );
      return;
    }

    let userId = null;
    let userEmail = null;
    let authSessionId = null;
    let usedLegacySession = false;
    const token = parseAuthToken(req);
    if (token) {
      try {
        const verified = verifyAccessToken(token);
        userId = verified.userId;
        authSessionId = verified.sessionId || null;
      } catch {
        const session = await getSession(token);
        if (session) {
          usedLegacySession = true;
          userId = session.user_id;
          userEmail = session.email;
          const deviceName = getDeviceName(req);
          await touchSession(token, deviceName);
        }
      }
    }

    if (pathname === "/v1/auth/refresh" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const refreshToken = body?.refreshToken || body?.token;
      if (!refreshToken || typeof refreshToken !== "string") {
        if (usedLegacySession && token && userId) {
          const deviceName = getDeviceName(req);
          await deleteSessionByTokenOrHash(token);
          const refresh = await issueRefreshToken({ userId, deviceName });
          const accessToken = signAccessToken({
            userId,
            scope: "user",
            ttlSec: ACCESS_TOKEN_TTL_SEC,
            sessionId: refresh.refreshTokenId,
          });
          res.livenewUserId = userId;
          sendJson(
            res,
            200,
            {
              ok: true,
              accessToken,
              refreshToken: refresh.refreshToken,
              expiresInSec: ACCESS_TOKEN_TTL_SEC,
              token: accessToken,
            },
            userId
          );
          return;
        }
        sendError(res, 400, "refresh_required", "refreshToken is required", "refreshToken");
        return;
      }
      let rotated;
      try {
        const deviceName = getDeviceName(req);
        rotated = await rotateRefreshToken(refreshToken, deviceName);
      } catch (err) {
        sendError(res, 401, err.code || "refresh_invalid", err.message || "refresh token invalid");
        return;
      }
      const accessToken = signAccessToken({
        userId: rotated.userId,
        scope: "user",
        ttlSec: ACCESS_TOKEN_TTL_SEC,
        sessionId: rotated.refreshTokenId,
      });
      res.livenewUserId = rotated.userId;
      sendJson(
        res,
        200,
        {
          ok: true,
          accessToken,
          refreshToken: rotated.refreshToken,
          expiresInSec: ACCESS_TOKEN_TTL_SEC,
          token: accessToken,
        },
        rotated.userId
      );
      return;
    }

    if (pathname === "/v1/auth/logout" && req.method === "POST") {
      if (!requireCsrf(req, res)) return;
      const body = await parseJson(req);
      const refreshToken = body?.refreshToken || body?.token;
      let revoked = false;
      if (refreshToken && typeof refreshToken === "string") {
        revoked = await revokeRefreshToken(refreshToken);
      } else if (authSessionId) {
        await revokeRefreshTokenById(authSessionId);
        revoked = true;
      } else if (usedLegacySession && token) {
        await deleteSessionByTokenOrHash(token);
        revoked = true;
      }
      if (!revoked) {
        sendError(res, 400, "refresh_required", "refreshToken is required", "refreshToken");
        return;
      }
      sendJson(res, 200, { ok: true }, userId || null);
      return;
    }

    if (!userId) {
      if (isAuthRequired()) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      userId = getUserId(req);
    }

    res.livenewUserId = userId;
    const send = (status, payload) => sendJson(res, status, payload, userId);
    const ensureUserEmail = async () => {
      if (userEmail) return userEmail;
      if (!userId) return null;
      const user = await getUserById(userId);
      userEmail = user?.email || null;
      return userEmail;
    };
    const requireAdmin = async () => {
      const email = await ensureUserEmail();
      if (!email) {
        sendError(res, 401, "auth_required", "Authorization required");
        return null;
      }
      if (!isAdminConfigured()) {
        sendError(res, 403, "admin_unconfigured", "Admin access not configured");
        return null;
      }
      if (config.isDevLike && !config.adminInDevEnabled) {
        sendError(res, 403, "admin_disabled_in_dev", "Admin access disabled in dev");
        return null;
      }
      if (!isAdmin(email)) {
        sendError(res, 403, "forbidden", "Admin access required");
        return null;
      }
      res.livenewIsAdmin = true;
      return email;
    };
    const auditAdmin = async (action, target = null, props = {}) => {
      if (!userId || !action) return;
      try {
        await insertAdminAudit({ adminUserId: userId, action, target, props });
      } catch (err) {
        logError({ event: "admin_audit_failed", action, target, error: err?.message || String(err) });
      }
    };

    if (!requireCsrf(req, res)) return;

    const isMutating = !["GET", "HEAD"].includes(req.method);
    if (userId) {
      const userCheck = checkUserRateLimit(userId, isMutating);
      if (!userCheck.ok) {
        sendError(res, 429, "rate_limited_user", "Too many requests");
        return;
      }
    }
    const cached = await loadUserState(userId);
    let state = cached.state;
    let version = cached.version;
    const requestTodayISO = getTodayISOForProfile(state.userProfile);
    await ensureDay3Retention(userId, requestTodayISO);
    let requestFlags = await getFeatureFlags();
    let featureFreezeEnabled = resolveFeatureFreeze(requestFlags);
    let incidentModeEnabled = resolveIncidentMode(requestFlags);
    let snapshotContext = null;
    const getSnapshotContext = async () => {
      if (snapshotContext && snapshotContext.userId === userId) return snapshotContext;
      snapshotContext = await resolveSnapshotContext({ userId, userProfile: state.userProfile, req, url });
      snapshotContext.userId = userId;
      return snapshotContext;
    };
    const getParamsForUser = async () => (await getSnapshotContext()).paramsState;
    const getLibraryForUser = async () => (await getSnapshotContext()).library;

    const dispatchForUser = async (event) => {
      const snapshotCtx = await getSnapshotContext();
      let attempts = 0;
      let currentState = state;
      let currentVersion = version;
      const atISO = event.atISO || new Date().toISOString();
      const eventWithAt = { ...event, atISO };
      const contentPrefs = await loadContentPrefs(userId);

      while (attempts < 2) {
        const prevStats = currentState.selectionStats;
        const prevState = currentState;
        const todayISO = getTodayISOForProfile(currentState.userProfile);
        const flags = await getFeatureFlags();
        requestFlags = flags;
        featureFreezeEnabled = resolveFeatureFreeze(flags);
        incidentModeEnabled = resolveIncidentMode(flags);
        const engineGuards = resolveEngineGuards(flags, incidentModeEnabled);
        const effectiveToggles = resolveRuleToggles(currentState, flags);
        const remindersEnabled = flagEnabled(flags, "reminders.enabled");
        const paramsState = snapshotCtx?.paramsState || (await getParameters(userId));
        const ruleConfig = buildRuleConfig(res.livenewRequestId, userId);
        let experimentEffects = {
          paramsEffective: paramsState.map,
          packOverride: null,
          experimentMeta: null,
          assignments: [],
        };
        try {
          experimentEffects = await applyExperiments({
            userId,
            cohortId: paramsState.cohortId || null,
            params: paramsState.map,
            logger: ruleConfig.logger,
          });
        } catch (err) {
          logError({
            event: "experiments_apply_failed",
            userId,
            requestId: res.livenewRequestId,
            error: err?.code || err?.message || String(err),
          });
        }
        const paramsMeta = {
          cohortId: paramsState.cohortId || null,
          versions: paramsState.versionsBySource || {},
          experiments: experimentEffects.assignments || [],
        };
        const paramsEffective = experimentEffects.paramsEffective || paramsState.map;
        const packOverride = experimentEffects.packOverride || null;
        const experimentMeta = experimentEffects.experimentMeta || null;
        const packId = packOverride || currentState.userProfile?.contentPack || null;
        const experimentIds = (experimentEffects.assignments || []).map(
          (assignment) => `${assignment.experimentId}:${assignment.variantKey}`
        );
        const modelStamp = buildModelStamp({
          snapshotId: snapshotCtx?.snapshotId || null,
          libraryHash: snapshotCtx?.snapshot?.libraryHash || null,
          packsHash: snapshotCtx?.snapshot?.packsHash || null,
          paramsVersions: paramsState.versions || {},
          packId,
          cohortId: paramsState.cohortId || null,
          experimentIds,
        });
        const ctxBase = {
          ruleToggles: effectiveToggles,
          params: paramsEffective,
          paramsMeta,
          now: { todayISO, atISO },
          incidentMode: incidentModeEnabled,
          engineGuards,
          packOverride,
          experimentMeta,
          ruleConfig,
          preferences: contentPrefs,
          library: snapshotCtx?.library || domain.defaultLibrary,
          modelStamp,
        };
        let resEvent = dispatch(currentState, eventWithAt, ctxBase);
        let nextState = resEvent.state;
        const regenPolicy = buildRegenPolicy(currentState, eventWithAt, nextState);
        if (regenPolicy) {
          resEvent = dispatch(currentState, eventWithAt, { ...ctxBase, regenPolicy });
          nextState = resEvent.state;
        }
        const guarded = applyPlanGuards(prevState, nextState, eventWithAt.type, engineGuards, res.livenewRequestId, userId);
        if (guarded !== nextState) {
          nextState = guarded;
          resEvent = { ...resEvent, state: nextState };
        }

        if (!resEvent.effects.persist && !resEvent.logEvent) {
          state = nextState;
          updateUserCache(userId, state, currentVersion);
          return { ...resEvent, state: nextState };
        }

        const saveRes = await saveUserState(userId, currentVersion, nextState);
        if (saveRes.ok) {
          if (EVENT_SOURCING) {
            await appendUserEvent(userId, { type: eventWithAt.type, payload: eventWithAt.payload || {}, atISO });
          }
          const diffs = diffSelectionStats(prevStats, nextState.selectionStats);
          for (const diff of diffs) {
            const field = diff.field === "notRelevant" ? "not_relevant" : diff.field;
            await bumpContentStats(userId, diff.itemId, field, diff.delta);
          }

          const changedDates = findChangedDates(prevState, nextState);
          const historyCause = historyCauseForEvent(eventWithAt.type);
          for (const dateISO of changedDates) {
            const dataMin = nextState.userProfile?.dataMinimization;
            const allowTraces = !dataMin?.enabled || dataMin?.storeTraces !== false;
            const trace = buildDecisionTrace(nextState, dateISO);
            if (trace && allowTraces) {
              await upsertDecisionTrace(userId, dateISO, trace);
            }
            const dayContract = toDayContract(nextState, dateISO, domain);
            const historyInsert = await insertDayPlanHistory({
              userId,
              dateISO,
              cause: historyCause,
              dayContract,
              traceRef: null,
              modelStamp: dayContract?.meta?.modelStamp || null,
            });
            const historyList = await listDayPlanHistory(userId, dateISO, 2);
            const prev = historyList.length > 1 ? historyList[1] : null;
            const dayPlan = nextState.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
            const drivers = nextState.lastStressStateByDate?.[dateISO]?.drivers || [];
            const summary = buildChangeSummary({
              fromDay: prev?.day || null,
              toDay: dayContract,
              dayPlan,
              drivers,
            });
            const summaryCause = summary?.why?.safetyLevel === "block" ? "safety" : historyCause;
            await insertPlanChangeSummary({
              userId,
              dateISO,
              cause: summaryCause,
              fromHistoryId: prev?.id || null,
              toHistoryId: historyInsert.id,
              summary,
            });
            if (remindersEnabled) {
              await upsertDailyReminders(userId, nextState, dateISO);
            }
          }

          const todayISO = getTodayISOForProfile(nextState.userProfile);
          if (!prevState.weekPlan && nextState.weekPlan) {
            const firstPlanDate = await getFirstFlagDate(userId, AnalyticsFlags.firstPlanGenerated);
            if (!firstPlanDate) {
              await setDailyFlag(todayISO, userId, AnalyticsFlags.firstPlanGenerated);
              await trackEvent(userId, AnalyticsFlags.firstPlanGenerated, {}, atISO, todayISO);
            }
          }

          const analyticsUpdates = {};
          if (eventWithAt.type === "CHECKIN_SAVED") analyticsUpdates.checkins_count = 1;
          if (eventWithAt.type === "BAD_DAY_MODE") analyticsUpdates.bad_day_mode_count = 1;
          if (
            eventWithAt.type === "FEEDBACK_SUBMITTED" &&
            (eventWithAt.payload?.reasonCode === "not_relevant" || eventWithAt.payload?.reason === "not_relevant")
          ) {
            analyticsUpdates.feedback_not_relevant_count = 1;
          }
          if (eventWithAt.type === "TOGGLE_PART_COMPLETION") {
            const dateISO = eventWithAt.payload?.dateISO;
            if (dateISO) {
              const prevParts = prevState.partCompletionByDate?.[dateISO] || {};
              const nextParts = nextState.partCompletionByDate?.[dateISO] || {};
              const prevAny = Boolean(prevParts.workout || prevParts.reset || prevParts.nutrition);
              const nextAny = Boolean(nextParts.workout || nextParts.reset || nextParts.nutrition);
              if (!prevAny && nextAny) {
                analyticsUpdates.any_part_days_count = 1;
                await setDailyFlag(dateISO, userId, AnalyticsFlags.anyRegulationCompleted);
                await trackEvent(userId, AnalyticsFlags.anyRegulationCompleted, { dateISO }, atISO, dateISO);
                const firstCompletionDate = await getFirstFlagDate(userId, AnalyticsFlags.firstCompletion);
                if (!firstCompletionDate) {
                  await setDailyFlag(dateISO, userId, AnalyticsFlags.firstCompletion);
                  await trackEvent(userId, AnalyticsFlags.firstCompletion, { dateISO }, atISO, dateISO);
                }
              }
            }
          }
          if (Object.keys(analyticsUpdates).length) {
            const activeCount = await recordActiveUser(todayISO, userId);
            analyticsUpdates.active_users_count = activeCount;
            await updateAnalyticsDaily(todayISO, analyticsUpdates);
          } else if (resEvent.effects.persist) {
            const activeCount = await recordActiveUser(todayISO, userId);
            await updateAnalyticsDaily(todayISO, { active_users_count: activeCount });
          }

          state = nextState;
          version = saveRes.version;
          updateUserCache(userId, state, version);
          invalidateUserCache(userId);
          return { ...resEvent, state: nextState };
        }

        const latest = await loadUserState(userId);
        currentState = latest.state;
        currentVersion = latest.version;
        attempts += 1;
      }

      throw Object.assign(new Error("State conflict"), {
        status: 409,
        code: "state_conflict",
      });
    };

    const getEngineGuardsSnapshot = () => resolveEngineGuards(requestFlags, incidentModeEnabled);

    const maybeStartReEntry = async (dateISO) => {
      if (!state.userProfile || !dateISO) return;
      const guards = getEngineGuardsSnapshot();
      if (guards.reentryEnabled === false) return;
      if (state.reEntry?.active) return;
      const profile = state.userProfile;
      const lastCompletion = profile.lastCompletionDateISO;
      const lastActiveAtISO = profile.lastActiveAtISO;
      const tz = getUserTimezone(profile);
      const boundary = getDayBoundaryHour(profile);
      const lastActiveDateISO = lastActiveAtISO
        ? toDateISOWithBoundary(new Date(lastActiveAtISO), tz, boundary)
        : null;
      const baseline = lastCompletion || lastActiveDateISO || profile.createdAtISO;
      if (!baseline || baseline >= dateISO) return;
      const diff = daysBetweenISO(baseline, dateISO);
      if (diff != null && diff >= 14) {
        const resEvent = await dispatchForUser({ type: "REENTRY_STARTED", payload: { startDateISO: dateISO } });
        state = resEvent.state;
      }
    };

    if (userId && state.userProfile) {
      const nowISO = new Date().toISOString();
      if (state.userProfile.lastActiveAtISO !== nowISO) {
        const touched = await dispatchForUser({ type: "LAST_ACTIVE_TOUCHED", payload: {}, atISO: nowISO });
        state = touched.state;
      }
    }

    if (pathname.startsWith("/v1/plan/") || pathname === "/v1/rail/today") {
      const ok = await ensureRequiredConsents(userId, res);
      if (!ok) return;
    }

    if (pathname === "/v1/profile" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateProfile(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const baseProfile = state.userProfile || {};
      const incomingProfile = validation.value.userProfile;
      const mergedProfile = { ...baseProfile, ...incomingProfile };
      if (!("dataMinimization" in incomingProfile)) {
        mergedProfile.dataMinimization = baseProfile.dataMinimization;
      }
      if (!("lastActiveAtISO" in incomingProfile)) {
        mergedProfile.lastActiveAtISO = baseProfile.lastActiveAtISO;
      }
      if (!("lastCompletionDateISO" in incomingProfile)) {
        mergedProfile.lastCompletionDateISO = baseProfile.lastCompletionDateISO;
      }
      if (!("createdAtISO" in incomingProfile)) {
        mergedProfile.createdAtISO = baseProfile.createdAtISO;
      }
      const userProfile = normalizeUserProfile(mergedProfile);
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      send(200, { ok: true, userProfile: state.userProfile, weekPlan: state.weekPlan });
      return;
    }

    if (pathname === "/v1/profile/timezone" && req.method === "PATCH") {
      const body = await parseJson(req);
      const validation = validateTimezone(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      if (!state.userProfile) {
        sendError(res, 400, "profile_required", "Profile required before updating timezone");
        return;
      }
      const nextProfile = {
        ...state.userProfile,
        timezone: validation.value.timezone,
        dayBoundaryHour:
          validation.value.dayBoundaryHour == null ? state.userProfile.dayBoundaryHour : validation.value.dayBoundaryHour,
      };
      const userProfile = normalizeUserProfile(nextProfile);
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      send(200, {
        ok: true,
        timezone: state.userProfile?.timezone || userProfile.timezone,
        dayBoundaryHour: state.userProfile?.dayBoundaryHour ?? userProfile.dayBoundaryHour,
      });
      return;
    }

    if (pathname === "/v1/consents/accept" && req.method === "POST") {
      const body = await parseJson(req);
      const consents = Array.isArray(body?.consents)
        ? body.consents.filter((entry) => typeof entry === "string")
        : [];
      const acceptTerms = body?.acceptTerms === true;
      const acceptPrivacy = body?.acceptPrivacy === true;
      const acceptAlpha = body?.acceptAlphaProcessing === true;
      const accepted = new Set(consents.map((c) => c.trim().toLowerCase()).filter(Boolean));
      if (acceptTerms) accepted.add("terms");
      if (acceptPrivacy) accepted.add("privacy");
      if (acceptAlpha) accepted.add("alpha_processing");
      const missing = REQUIRED_CONSENTS.filter((key) => !accepted.has(key));
      if (missing.length) {
        sendError(
          res,
          badRequest("consent_required", "Missing required consent", "consents", {
            required: missing,
            expose: true,
          })
        );
        return;
      }
      await upsertUserConsents(userId, REQUIRED_CONSENTS);
      send(200, { ok: true, accepted: REQUIRED_CONSENTS });
      return;
    }

    if (pathname === "/v1/onboard/complete" && req.method === "POST") {
      const body = await parseJson(req);
      const profileValidation = validateProfile({ userProfile: body?.userProfile });
      if (!profileValidation.ok) {
        sendError(res, 400, profileValidation.error.code, profileValidation.error.message, profileValidation.error.field);
        return;
      }
      const consent = body?.consent || {};
      const acceptTerms = consent.terms === true || body?.acceptTerms === true;
      const acceptPrivacy = consent.privacy === true || body?.acceptPrivacy === true;
      const acceptAlpha =
        consent.alphaProcessing === true ||
        consent.alpha_processing === true ||
        body?.acceptAlphaProcessing === true;
      if (!acceptTerms || !acceptPrivacy || !acceptAlpha) {
        sendError(
          res,
          badRequest("consent_required", "Terms, privacy, and alpha processing consent required", "consents", {
            required: REQUIRED_CONSENTS,
            expose: true,
          })
        );
        return;
      }
      let targetUserId = userId;
      let targetEmail = userEmail;
      let issueTokens = false;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!targetUserId && isAuthRequired()) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      if (!isAuthRequired() && email) {
        const user = await getOrCreateUser(email);
        targetUserId = user.id;
        targetEmail = user.email;
        issueTokens = true;
      }
      if (!targetUserId) {
        targetUserId = getUserId(req);
      }
      if (targetUserId !== userId) {
        userId = targetUserId;
        userEmail = targetEmail;
        res.livenewUserId = userId;
        snapshotContext = null;
        const cached = await loadUserState(userId);
        state = cached.state;
        version = cached.version;
      }
      const paramsState = await getParamsForUser();
      const checkinValidation = validateCheckIn(
        { checkIn: body?.firstCheckIn },
        { allowedTimes: paramsState.map?.timeBuckets?.allowed }
      );
      if (!checkinValidation.ok) {
        sendError(res, 400, checkinValidation.error.code, checkinValidation.error.message, checkinValidation.error.field);
        return;
      }
      await upsertUserConsents(userId, REQUIRED_CONSENTS);

      const packId = typeof body?.packId === "string" ? body.packId.trim() : null;
      const userProfile = normalizeUserProfile({
        ...profileValidation.value.userProfile,
        contentPack: packId || profileValidation.value.userProfile?.contentPack,
      });
      const checkIn = applyDataMinimizationToCheckIn(checkinValidation.value.checkIn, userProfile);
      const currentCohort = await getUserCohort(userId);
      if (!currentCohort || !currentCohort.overriddenByAdmin) {
        await setUserCohort(userId, cohortForCheckIn(checkIn), false);
      }
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      await dispatchForUser({ type: "CHECKIN_SAVED", payload: { checkIn } });
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      const onboardDateISO = checkIn?.dateISO || getTodayISOForProfile(userProfile);
      await setDailyFlag(onboardDateISO, userId, AnalyticsFlags.onboardCompleted);
      await trackEvent(userId, AnalyticsFlags.onboardCompleted, { dateISO: onboardDateISO }, new Date().toISOString(), onboardDateISO);
      const dateISO = checkIn?.dateISO || getTodayISOForProfile(userProfile);
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const library = await getLibraryForUser();
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "onboard_day_invariant",
        requestId,
        { paramsState, library }
      );
      state = ensured.state;
      const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
      const prefs = await loadContentPrefs(userId);
      const railReset = pickRailReset({ dayPlan, checkIn, library, preferences: prefs });
      const rail = {
        checkIn: {
          requiredFields: ["stress", "sleepQuality", "energy", "timeAvailableMin"],
          estimatedSeconds: 10,
        },
        reset: railReset
          ? {
              id: railReset.id || null,
              title: railReset.title || null,
              minutes: railReset.minutes ?? null,
              steps: Array.isArray(railReset.steps) ? railReset.steps : [],
            }
          : null,
      };
      const payload = { ok: true, weekPlan: state.weekPlan, week: state.weekPlan, day: ensured.day, rail };
      if (issueTokens) {
        const deviceName = getDeviceName(req);
        const refresh = await issueRefreshToken({ userId, deviceName });
        const accessToken = signAccessToken({
          userId,
          scope: "user",
          ttlSec: ACCESS_TOKEN_TTL_SEC,
          sessionId: refresh.refreshTokenId,
        });
        payload.accessToken = accessToken;
        payload.refreshToken = refresh.refreshToken;
        payload.expiresInSec = ACCESS_TOKEN_TTL_SEC;
        payload.token = accessToken;
      }
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/week" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const dateParam = url.searchParams.get("date");
      const todayISO = getTodayISOForProfile(state.userProfile);
      const weekAnchorISO = dateParam || todayISO;
      if (dateParam) {
        const validation = validateDateParam(dateParam, "date");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      await dispatchForUser({ type: "ENSURE_WEEK", payload: {} });
      if (weekAnchorISO && weekAnchorISO !== state.weekPlan?.startDateISO) {
        await dispatchForUser({ type: "WEEK_REBUILD", payload: { weekAnchorISO } });
      }
      const validWeek = await ensureValidWeekPlan(userId, state, "plan_week_invariant", requestId);
      state = validWeek.state;
      const payload = { ok: true, weekPlan: validWeek.weekPlan };
      setCachedResponse(userId, pathname, url.search, payload, CACHE_TTLS.planWeek);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/force-refresh" && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.regenEnabled === false) {
        sendError(res, 403, "feature_disabled", "Plan regeneration is disabled");
        return;
      }
      const body = await parseJson(req);
      const dateISO = body?.dateISO || getTodayISOForProfile(state.userProfile);
      const validation = validateDateParam(dateISO, "dateISO");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const resEvent = await dispatchForUser({
        type: "FORCE_REFRESH",
        payload: { dateISO, forced: true },
      });
      state = resEvent.state;
      const paramsState = await getParamsForUser();
      const library = await getLibraryForUser();
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "force_refresh_invariant",
        requestId,
        { paramsState, library }
      );
      state = ensured.state;
      send(200, { ok: true, day: ensured.day });
      return;
    }

    if (pathname === "/v1/rail/today" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const dateISO = getTodayISOForProfile(state.userProfile);
      await maybeStartReEntry(dateISO);
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const paramsState = await getParamsForUser();
      const library = await getLibraryForUser();
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "rail_today_invariant",
        requestId,
        { paramsState, library }
      );
      state = ensured.state;
      const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
      const checkIn = latestCheckInForDate(state.checkIns, dateISO);
      const prefs = await loadContentPrefs(userId);
      const railReset = pickRailReset({ dayPlan, checkIn, library, preferences: prefs });
      const rail = {
        checkIn: {
          requiredFields: ["stress", "sleepQuality", "energy", "timeAvailableMin"],
          estimatedSeconds: 10,
        },
        reset: railReset
          ? {
              id: railReset.id || null,
              title: railReset.title || null,
              minutes: railReset.minutes ?? null,
              steps: Array.isArray(railReset.steps) ? railReset.steps : [],
            }
          : null,
      };
      const payload = { ok: true, rail, day: ensured.day };
      setCachedResponse(userId, pathname, url.search, payload, CACHE_TTLS.railToday);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/day" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const dateParam = url.searchParams.get("date");
      const dateISO = dateParam || getTodayISOForProfile(state.userProfile);
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      if (!dateParam) {
        await maybeStartReEntry(dateISO);
      }
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const paramsState = await getParamsForUser();
      const library = await getLibraryForUser();
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "plan_day_invariant",
        requestId,
        { paramsState, library }
      );
      state = ensured.state;
      const payload = { ok: true, day: ensured.day };
      setCachedResponse(userId, pathname, url.search, payload, CACHE_TTLS.planDay);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/plan/why" && req.method === "GET") {
      const dateParam = url.searchParams.get("date");
      const dateISO = dateParam || getTodayISOForProfile(state.userProfile);
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      state = await ensureWeekForDate(state, dateISO, dispatchForUser);
      const paramsState = await getParamsForUser();
      const library = await getLibraryForUser();
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "plan_why_invariant",
        requestId,
        { paramsState, library }
      );
      state = ensured.state;
      const summaries = await listPlanChangeSummaries(userId, dateISO, 1);
      const latestSummary = summaries.length ? summaries[0] : null;
      send(200, {
        ok: true,
        dateISO,
        why: ensured.day?.why || null,
        changeSummary: latestSummary,
      });
      return;
    }

    if (pathname === "/v1/plan/history/day" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendError(res, 400, "date_required", "date query param is required", "date");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
      const history = await listDayPlanHistory(userId, dateISO, limit);
      send(200, { ok: true, dateISO, history });
      return;
    }

    if (pathname === "/v1/plan/compare" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      const fromId = url.searchParams.get("fromId");
      const toId = url.searchParams.get("toId");
      if (!dateISO || !fromId || !toId) {
        sendError(res, 400, "params_required", "date, fromId, and toId are required");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const from = await getDayPlanHistoryById(fromId);
      const to = await getDayPlanHistoryById(toId);
      if (!from || !to || from.userId !== userId || to.userId !== userId) {
        sendError(res, 404, "history_not_found", "history item not found");
        return;
      }
      const diff = diffDayContracts(from.day, to.day);
      send(200, { ok: true, dateISO, from, to, diff });
      return;
    }

    if (pathname === "/v1/plan/changes" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendError(res, 400, "date_required", "date query param is required", "date");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
      const items = await listPlanChangeSummaries(userId, dateISO, limit);
      send(200, { ok: true, items });
      return;
    }

    if (pathname === "/v1/changelog" && req.method === "GET") {
      const audienceParam = String(url.searchParams.get("audience") || "user").toLowerCase();
      const audience = audienceParam === "admin" ? "admin" : "user";
      if (audience !== "user") {
        sendError(res, 403, "forbidden", "User changelog only");
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 5);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 5;
      const items = await listChangelogEntries({ audience: "user", limit });
      send(200, { ok: true, items });
      return;
    }

    if (pathname === "/v1/checkin" && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.checkinsEnabled === false) {
        sendError(res, 403, "feature_disabled", "Check-ins are disabled");
        return;
      }
      const body = await parseJson(req);
      const paramsState = await getParamsForUser();
      const validation = validateCheckIn(body, { allowedTimes: paramsState.map?.timeBuckets?.allowed });
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const checkIn = applyDataMinimizationToCheckIn(validation.value.checkIn, state.userProfile);
      const isBackdated = checkIn.dateISO < requestTodayISO;
      const { result } = await dispatchForUser({ type: "CHECKIN_SAVED", payload: { checkIn } });
      const tomorrowISO = checkIn?.dateISO ? domain.addDaysISO(checkIn.dateISO, 1) : null;
      const day = checkIn?.dateISO ? toDayContract(state, checkIn.dateISO, domain) : null;
      const tomorrow = tomorrowISO ? toDayContract(state, tomorrowISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || checkIn?.dateISO || null,
        notes: result?.notes || [],
        day,
        tomorrow: !isBackdated && checkIn?.stress >= 7 && checkIn?.sleepQuality <= 5 ? tomorrow : null,
        backdated: isBackdated,
        rebuiltDates: isBackdated ? [checkIn.dateISO] : [],
      });
      return;
    }

    if (pathname === "/v1/signal" && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.signalsEnabled === false) {
        sendError(res, 403, "feature_disabled", "Signals are disabled");
        return;
      }
      const body = await parseJson(req);
      const validation = validateSignal(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, signal } = validation.value;
      const nowMs = Date.now();
      const lastSignal = lastSignalByUser.get(userId);
      if (
        lastSignal &&
        lastSignal.dateISO === dateISO &&
        lastSignal.signal === signal &&
        nowMs - lastSignal.atMs < 500
      ) {
        const day = toDayContract(state, dateISO, domain);
        send(202, { ok: true, collapsed: true, changedDayISO: dateISO, day });
        return;
      }
      lastSignalByUser.set(userId, { atMs: nowMs, dateISO, signal });

      const { result } = await dispatchForUser({ type: "QUICK_SIGNAL", payload: { dateISO, signal } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
      });
      return;
    }

    if (pathname === "/v1/bad-day" && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.regenEnabled === false) {
        sendError(res, 403, "feature_disabled", "Plan regeneration is disabled");
        return;
      }
      const body = await parseJson(req);
      const validation = validateDateParam(body?.dateISO, "dateISO");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const dateISO = validation.value;
      const { result } = await dispatchForUser({ type: "BAD_DAY_MODE", payload: { dateISO } });
      const day = dateISO ? toDayContract(state, dateISO, domain) : null;
      send(200, {
        ok: true,
        changedDayISO: result?.changedDayISO || dateISO,
        notes: result?.notes || [],
        day,
      });
      return;
    }

    if (pathname === "/v1/feedback" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateFeedback(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, helped, reasonCode, itemId, kind } = validation.value;
      const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
      let resolvedKind = kind || null;
      let resolvedItemId = itemId || null;
      if (!resolvedKind && resolvedItemId && dayPlan) {
        if (dayPlan.workout?.id === resolvedItemId) resolvedKind = "workout";
        if (dayPlan.reset?.id === resolvedItemId) resolvedKind = "reset";
        if (dayPlan.nutrition?.id === resolvedItemId) resolvedKind = "nutrition";
      }
      if (!resolvedItemId && resolvedKind && dayPlan) {
        if (resolvedKind === "workout") resolvedItemId = dayPlan.workout?.id || null;
        if (resolvedKind === "reset") resolvedItemId = dayPlan.reset?.id || null;
        if (resolvedKind === "nutrition") resolvedItemId = dayPlan.nutrition?.id || null;
      }
      const { result } = await dispatchForUser({
        type: "FEEDBACK_SUBMITTED",
        payload: { dateISO, helped, reasonCode, itemId: resolvedItemId, kind: resolvedKind },
      });
      if (reasonCode && resolvedItemId && resolvedKind) {
        await insertContentFeedback({
          userId,
          itemId: resolvedItemId,
          kind: resolvedKind,
          reasonCode,
          dateISO,
        });
      }
      send(200, {
        ok: true,
        notes: result?.notes || [],
        modifiers: state.modifiers || {},
      });
      return;
    }

    if (pathname === "/v1/content/prefs" && req.method === "GET") {
      const prefs = await listUserContentPrefs(userId);
      send(200, { ok: true, prefs });
      return;
    }

    if (pathname === "/v1/content/prefs" && req.method === "POST") {
      const body = await parseJson(req);
      const itemId = body?.itemId;
      const pref = body?.pref;
      if (!itemId || typeof itemId !== "string") {
        sendError(res, 400, "itemId_required", "itemId is required", "itemId");
        return;
      }
      if (pref !== "favorite" && pref !== "avoid") {
        sendError(res, 400, "pref_invalid", "pref must be favorite or avoid", "pref");
        return;
      }
      const updated = await upsertUserContentPref(userId, itemId, pref);
      invalidateContentPrefs(userId);
      invalidateUserCache(userId);
      send(200, { ok: true, pref: updated });
      return;
    }

    const prefsDeleteMatch = pathname.match(/^\\/v1\\/content\\/prefs\\/([^/]+)$/);
    if (prefsDeleteMatch && req.method === "DELETE") {
      const itemId = prefsDeleteMatch[1];
      if (!itemId) {
        sendError(res, 400, "itemId_required", "itemId is required", "itemId");
        return;
      }
      const removed = await deleteUserContentPref(userId, itemId);
      invalidateContentPrefs(userId);
      invalidateUserCache(userId);
      send(200, { ok: true, removed });
      return;
    }

    if (pathname === "/v1/complete" && req.method === "POST") {
      const body = await parseJson(req);
      const validation = validateComplete(body);
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const { dateISO, part } = validation.value;
      await dispatchForUser({ type: "TOGGLE_PART_COMPLETION", payload: { dateISO, part } });
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      send(200, {
        ok: true,
        completion: state.partCompletionByDate?.[dateISO] || {},
        progress,
      });
      return;
    }

    if (pathname === "/v1/community/opt-in" && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.communityEnabled === false) {
        sendError(res, 403, "feature_disabled", "Community is disabled");
        return;
      }
      const body = await parseJson(req);
      const optedIn = body?.optedIn === true;
      const updated = await setCommunityOptIn(userId, optedIn);
      send(200, { ok: true, optedIn: updated.optedIn, updatedAt: updated.updatedAt });
      return;
    }

    if (pathname === "/v1/community/opt-in" && req.method === "GET") {
      const guards = getEngineGuardsSnapshot();
      if (guards.communityEnabled === false) {
        sendError(res, 403, "feature_disabled", "Community is disabled");
        return;
      }
      const status = await getCommunityOptIn(userId);
      send(200, { ok: true, optedIn: status.optedIn, updatedAt: status.updatedAt });
      return;
    }

    const communityRespondMatch = pathname.match(/^\/v1\/community\/resets\/([^/]+)\/respond$/);
    if (communityRespondMatch && req.method === "POST") {
      const guards = getEngineGuardsSnapshot();
      if (guards.communityEnabled === false) {
        sendError(res, 403, "feature_disabled", "Community is disabled");
        return;
      }
      const resetId = communityRespondMatch[1];
      const body = await parseJson(req);
      const text = sanitizeCommunityText(body?.text);
      if (!text || text.length < 5) {
        sendError(res, 400, "response_invalid", "Response text is required", "text");
        return;
      }
      const optIn = await getCommunityOptIn(userId);
      if (!optIn.optedIn) {
        sendError(res, 403, "opt_in_required", "Opt-in required to respond");
        return;
      }
      const created = await insertCommunityResponse({ resetItemId: resetId, userId, text, status: "pending" });
      send(200, { ok: true, response: { id: created.id, status: created.status } });
      return;
    }

    const communityListMatch = pathname.match(/^\/v1\/community\/resets\/([^/]+)$/);
    if (communityListMatch && req.method === "GET") {
      const guards = getEngineGuardsSnapshot();
      if (guards.communityEnabled === false) {
        sendError(res, 403, "feature_disabled", "Community is disabled");
        return;
      }
      const resetId = communityListMatch[1];
      const responses = await listCommunityResponses(resetId, "approved", 20);
      send(200, {
        ok: true,
        responses: responses.map((entry) => ({
          id: entry.id,
          text: entry.text,
          created_at: entry.createdAt,
        })),
      });
      return;
    }

    if (pathname === "/v1/progress" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const progress = domain.computeProgress({
        checkIns: state.checkIns || [],
        weekPlan: state.weekPlan,
        completions: state.partCompletionByDate || {},
      });
      const payload = { ok: true, progress };
      setCachedResponse(userId, pathname, url.search, payload);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/trends" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const daysParam = url.searchParams.get("days") || "7";
      const daysNum = Number(daysParam);
      const allowed = [7, 14, 30];
      if (!allowed.includes(daysNum)) {
        sendError(res, 400, "days_invalid", "days must be 7, 14, or 30", "days");
        return;
      }
      const trends = buildTrends(state, daysNum, requestTodayISO);
      const payload = { ok: true, days: trends };
      setCachedResponse(userId, pathname, url.search, payload, CACHE_TTLS.trends);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/outcomes" && req.method === "GET") {
      const cached = getCachedResponse(userId, pathname, url.search);
      if (cached) {
        send(200, cached);
        return;
      }
      const daysParam = url.searchParams.get("days") || "7";
      const daysNum = Number(daysParam);
      const allowed = [7, 14, 30];
      if (!allowed.includes(daysNum)) {
        sendError(res, 400, "days_invalid", "days must be 7, 14, or 30", "days");
        return;
      }
      const toISO = requestTodayISO;
      const fromISO = domain.addDaysISO(toISO, -(daysNum - 1));
      const historyList = await listLatestDayPlanHistoryByRange(userId, fromISO, toISO);
      const historyByDate = new Map();
      historyList.forEach((entry) => historyByDate.set(entry.dateISO, entry.day));
      const reminderIntents = await listReminderIntentsByRange(userId, fromISO, toISO);
      const outcomes = buildOutcomes({ state, days: daysNum, todayISO: requestTodayISO, reminderIntents, historyByDate });
      const payload = { ok: true, ...outcomes };
      setCachedResponse(userId, pathname, url.search, payload, CACHE_TTLS.outcomes);
      send(200, payload);
      return;
    }

    if (pathname === "/v1/reminders" && req.method === "GET") {
      const dateISO = url.searchParams.get("date");
      if (!dateISO) {
        sendError(res, 400, "date_required", "date query param is required", "date");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const items = await listReminderIntentsByDate(userId, dateISO);
      send(200, { ok: true, items });
      return;
    }

    const reminderActionMatch = pathname.match(/^\/v1\/reminders\/([^/]+)\/(dismiss|complete)$/);
    if (reminderActionMatch && req.method === "POST") {
      const reminderId = reminderActionMatch[1];
      const action = reminderActionMatch[2];
      const status = action === "dismiss" ? "dismissed" : "completed";
      const updated = await updateReminderIntentStatus(reminderId, status, userId);
      if (!updated) {
        sendError(res, 404, "not_found", "Reminder not found");
        return;
      }
      send(200, { ok: true, id: reminderId, status });
      return;
    }

    if (pathname === "/v1/account/export" && req.method === "GET") {
      const events = await getUserEventsRecent(userId, 200);
      const traces = await listDecisionTracesRecent(userId, 30);
      const exportPayload = {
        userProfile: state.userProfile || null,
        checkIns: state.checkIns || [],
        completions: state.partCompletionByDate || {},
        feedback: state.feedback || [],
        events,
        decisionTraces: traces,
      };
      send(200, { ok: true, export: exportPayload });
      return;
    }

    if (pathname === "/v1/account/privacy" && req.method === "PATCH") {
      const body = await parseJson(req);
      const dataMin = body?.dataMinimization;
      if (!dataMin || typeof dataMin !== "object") {
        sendError(res, 400, "dataMinimization_required", "dataMinimization is required", "dataMinimization");
        return;
      }
      if (!state.userProfile) {
        sendError(res, 400, "profile_required", "Profile required before setting privacy");
        return;
      }
      const userProfile = normalizeUserProfile({ ...state.userProfile, dataMinimization: dataMin });
      await dispatchForUser({ type: "BASELINE_SAVED", payload: { userProfile } });
      send(200, { ok: true, dataMinimization: state.userProfile?.dataMinimization });
      return;
    }

    if (pathname === "/v1/account/cohort" && req.method === "GET") {
      const cohort = await getUserCohort(userId);
      send(200, { ok: true, cohort: cohort || null });
      return;
    }

    if (pathname === "/v1/account/sessions" && req.method === "GET") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const sessions = await listRefreshTokensByUser(userId);
      const list = sessions.map((session) => ({
        token: session.id,
        deviceName: session.deviceName,
        createdAt: session.createdAt,
        lastSeenAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: authSessionId ? session.id === authSessionId : false,
        revokedAt: session.revokedAt,
      }));
      if (!list.length && usedLegacySession) {
        const legacy = await listSessionsByUser(userId);
        legacy.forEach((session) => {
          list.push({
            token: session.tokenHash,
            deviceName: session.deviceName,
            createdAt: session.createdAt,
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt,
            isCurrent: false,
          });
        });
      }
      send(200, { ok: true, sessions: list });
      return;
    }

    if (pathname === "/v1/account/sessions/revoke" && req.method === "POST") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      const revokeToken = body?.token;
      if (!revokeToken || typeof revokeToken !== "string") {
        sendError(res, 400, "token_required", "token is required", "token");
        return;
      }
      if (authSessionId && revokeToken === authSessionId) {
        sendError(res, 400, "cannot_revoke_current", "Use auth/refresh or logout to revoke current session");
        return;
      }
      const sessions = await listRefreshTokensByUser(userId);
      if (sessions.some((session) => session.id === revokeToken)) {
        await revokeRefreshTokenById(revokeToken);
      } else if (usedLegacySession) {
        await deleteSessionByTokenOrHash(revokeToken);
      } else {
        sendError(res, 404, "session_not_found", "session not found");
        return;
      }
      send(200, { ok: true });
      return;
    }

    if (pathname === "/v1/account/sessions/name" && req.method === "POST") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      const deviceName = typeof body?.deviceName === "string" ? body.deviceName.trim() : "";
      if (!deviceName) {
        sendError(res, 400, "device_name_required", "deviceName is required", "deviceName");
        return;
      }
      const trimmed = deviceName.slice(0, 64);
      if (authSessionId) {
        await updateRefreshTokenDeviceName(authSessionId, trimmed);
      } else if (usedLegacySession) {
        await touchSession(token, trimmed);
      }
      send(200, { ok: true, deviceName: trimmed });
      return;
    }

    if (pathname === "/v1/account" && req.method === "DELETE") {
      if (!token) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const confirmHeader = req.headers["x-confirm-delete"];
      if (confirmHeader !== "DELETE") {
        sendError(res, 400, "confirm_required", "x-confirm-delete must be DELETE", "x-confirm-delete");
        return;
      }
      const body = await parseJson(req);
      if (body?.confirm !== "LiveNew") {
        sendError(res, 400, "confirm_required", "confirm must be LiveNew", "confirm");
        return;
      }
      await deleteUserData(userId);
      userStates.delete(userId);
      send(200, { ok: true });
      return;
    }

    if (pathname === "/v1/admin/me" && req.method === "GET") {
      const email = await ensureUserEmail();
      if (!email) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const admin = isAdmin(email);
      send(200, { ok: true, isAdmin: admin, email });
      return;
    }

    const validatorRunMatch = pathname.match(/^\/v1\/admin\/validator\/runs\/([^/]+)$/);
    if (validatorRunMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const runId = validatorRunMatch[1];
      const run = await getValidatorRun(runId);
      if (!run) {
        sendError(res, 404, "validator_run_not_found", "validator run not found");
        return;
      }
      send(200, { ok: true, run });
      return;
    }

    if (pathname === "/v1/admin/validator/latest" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = "engine_matrix";
      const run = await getLatestValidatorRun(kind);
      send(200, {
        ok: true,
        kind,
        latest: run,
        releaseBlocked: run ? !run.ok : false,
      });
      return;
    }

    if (pathname === "/v1/admin/validator/run" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const kind = String(body?.kind || "engine_matrix");
      if (kind !== "engine_matrix") {
        sendError(res, 400, "validator_kind_invalid", "kind must be engine_matrix", "kind");
        return;
      }
      const report = await runEngineValidatorTask();
      await auditAdmin("validator.run", report.runId, { kind, ok: report.ok, failed: report.totals?.failed || 0 });
      send(200, { ok: true, kind, runId: report.runId, report });
      return;
    }

    if (pathname === "/v1/admin/snapshots/diff" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const fromId = url.searchParams.get("from");
      const toId = url.searchParams.get("to");
      if (!fromId || !toId) {
        sendError(res, 400, "params_required", "from and to snapshot ids are required", "from");
        return;
      }
      const itemsA = await listContentSnapshotItems(fromId);
      const itemsB = await listContentSnapshotItems(toId);
      const packsA = await listContentSnapshotPacks(fromId);
      const packsB = await listContentSnapshotPacks(toId);
      const paramsA = await listContentSnapshotParams(fromId);
      const paramsB = await listContentSnapshotParams(toId);
      const diff = diffSnapshots({
        itemsA,
        itemsB,
        packsA,
        packsB,
        paramsA,
        paramsB,
      });
      send(200, { ok: true, from: fromId, to: toId, diff });
      return;
    }

    if (pathname === "/v1/admin/snapshots/create" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const note = typeof body?.note === "string" ? body.note.trim() : null;
      const snapshotId = await createSnapshotId();
      const items = normalizeSnapshotItems(await listContentItems(undefined, true, { statuses: ["enabled"] }));
      const packs = normalizeSnapshotPacks(await listContentPacks());
      const params = normalizeSnapshotParams(await listParameters());
      const hashes = computeSnapshotHashes({ items, packs, params });
      const snapshot = await createContentSnapshot({
        id: snapshotId,
        createdByAdmin: userId,
        note,
        libraryHash: hashes.libraryHash,
        packsHash: hashes.packsHash,
        paramsHash: hashes.paramsHash,
        items,
        packs,
        params,
      });
      await auditAdmin("snapshot.create", snapshotId, { note });
      send(200, {
        ok: true,
        snapshot: {
          ...snapshot,
          libraryHash: hashes.libraryHash,
          packsHash: hashes.packsHash,
          paramsHash: hashes.paramsHash,
          status: "draft",
        },
      });
      return;
    }

    const snapshotReleaseMatch = pathname.match(/^\/v1\/admin\/snapshots\/([^/]+)\/release$/);
    if (snapshotReleaseMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const snapshotId = snapshotReleaseMatch[1];
      const snapshot = await getContentSnapshot(snapshotId);
      if (!snapshot) {
        sendError(res, 404, "not_found", "Snapshot not found");
        return;
      }
      const { checklist, validator } = await computeReleaseChecklistState();
      if (!checklist.pass || !(validator?.ok)) {
        sendError(res, 409, "release_blocked", "Release blocked by checklist", null, {
          checks: checklist.checks,
          expose: true,
        });
        return;
      }
      const updated = await updateContentSnapshotStatus({
        snapshotId,
        status: "released",
        releasedAt: new Date().toISOString(),
        rolledBackAt: null,
      });
      await setDefaultSnapshotId(snapshotId);
      await auditAdmin("snapshot.release", snapshotId, { libraryHash: snapshot.libraryHash });
      send(200, { ok: true, snapshot: updated, defaultSnapshotId: snapshotId });
      return;
    }

    const snapshotRollbackMatch = pathname.match(/^\/v1\/admin\/snapshots\/([^/]+)\/rollback$/);
    if (snapshotRollbackMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const snapshotId = snapshotRollbackMatch[1];
      const snapshot = await getContentSnapshot(snapshotId);
      if (!snapshot) {
        sendError(res, 404, "not_found", "Snapshot not found");
        return;
      }
      const body = await parseJson(req);
      let targetSnapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
      if (!targetSnapshotId) {
        const released = await listContentSnapshots({ status: "released", limit: 5 });
        const fallback = released.find((entry) => entry.id !== snapshotId);
        targetSnapshotId = fallback?.id || "";
      }
      if (!targetSnapshotId) {
        sendError(res, 409, "rollback_unavailable", "No released snapshot available for rollback");
        return;
      }
      await setDefaultSnapshotId(targetSnapshotId);
      const updated = await updateContentSnapshotStatus({
        snapshotId,
        status: "rolled_back",
        releasedAt: snapshot.releasedAt || null,
        rolledBackAt: new Date().toISOString(),
      });
      await auditAdmin("snapshot.rollback", snapshotId, { targetSnapshotId });
      send(200, { ok: true, snapshot: updated, defaultSnapshotId: targetSnapshotId });
      return;
    }

    const snapshotGetMatch = pathname.match(/^\/v1\/admin\/snapshots\/([^/]+)$/);
    if (snapshotGetMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const snapshotId = snapshotGetMatch[1];
      const snapshot = await getContentSnapshot(snapshotId);
      if (!snapshot) {
        sendError(res, 404, "not_found", "Snapshot not found");
        return;
      }
      const items = await listContentSnapshotItems(snapshotId);
      const packs = await listContentSnapshotPacks(snapshotId);
      const params = await listContentSnapshotParams(snapshotId);
      send(200, {
        ok: true,
        snapshot,
        counts: { items: items.length, packs: packs.length, params: params.length },
      });
      return;
    }

    if (pathname === "/v1/admin/snapshots" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const status = url.searchParams.get("status");
      const snapshots = await listContentSnapshots({ status: status || null, limit: 50 });
      const defaultSnapshotId = await getDefaultSnapshotId();
      send(200, { ok: true, snapshots, defaultSnapshotId });
      return;
    }

    if (pathname === "/v1/admin/ops/status" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const validator = await getLatestValidatorRun("engine_matrix");
      const loadtestRun = await getLatestOpsRun("loadtest");
      const loadtestEval = loadtestRun ? evaluateLoadtestReport(loadtestRun.report, { maxP95MsByRoute: config.maxP95MsByRoute, maxErrorRate: config.maxErrorRate }) : null;
      const backups = await summarizeBackups();
      const runningExperiments = await listExperiments("running");
      const packs = await listContentPacks();
      const parameters = await listParameters();
      const defaultSnapshotId = await getDefaultSnapshotId();
      const latestReleasedSnapshot = await getLatestReleasedSnapshot();
      const releaseChecklistState = await computeReleaseChecklistState();
      send(200, {
        ok: true,
        validator: {
          latestOk: validator ? validator.ok : false,
          latestRunId: validator?.id || null,
          latestAtISO: validator?.atISO || null,
          failuresCount: validator?.report?.totals?.failed || 0,
        },
        loadtest: {
          latestOk: loadtestRun ? loadtestRun.ok && (loadtestEval?.ok ?? true) : false,
          latestAtISO: loadtestRun?.atISO || null,
          p95ByRoute: loadtestEval?.p95ByRoute || {},
          errorRate: loadtestEval?.errorRate ?? null,
        },
        backups: {
          latestAtISO: backups.latestAtISO,
          countLast14: backups.countLast14,
        },
        experiments: { runningCount: runningExperiments.length },
        packs: { updatedAt: latestUpdatedAt(packs) },
        parameters: { updatedAt: latestUpdatedAt(parameters) },
        snapshots: {
          defaultSnapshotId: defaultSnapshotId || null,
          latestReleasedSnapshotId: latestReleasedSnapshot?.id || null,
          validatorOkAgainstDefault: validator ? validator.ok : false,
          validatorRunId: validator?.id || null,
        },
        releaseChecklistPass: releaseChecklistState.checklist?.pass ?? false,
      });
      return;
    }

    if (pathname === "/v1/admin/ops/loadtest/run" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const protoHeader = req.headers["x-forwarded-proto"];
      const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
      const scheme = proto ? String(proto).split(",")[0].trim() : "http";
      const baseUrl = `${scheme}://${req.headers.host}`;
      const authTokenHeader = req.headers.authorization;
      const authToken = Array.isArray(authTokenHeader) ? authTokenHeader[0] : authTokenHeader;
      const report = await runLoadtestScript({ baseUrl, authToken: authToken || null });
      const evaluation = report?.metrics ? evaluateLoadtestReport(report, { maxP95MsByRoute: config.maxP95MsByRoute, maxErrorRate: config.maxErrorRate }) : { ok: false, p95ByRoute: {}, errorRate: null };
      const ok = report?.ok === true && evaluation.ok;
      const stored = await insertOpsRun({
        kind: "loadtest",
        ok,
        report: { ...(report || {}), evaluation },
      });
      await auditAdmin("ops.loadtest.run", stored.id, { ok });
      send(200, { ok: true, runId: stored.id, report: stored.report });
      return;
    }

    if (pathname === "/v1/admin/ops/loadtest/latest" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const run = await getLatestOpsRun("loadtest");
      const evaluation = run ? evaluateLoadtestReport(run.report, { maxP95MsByRoute: config.maxP95MsByRoute, maxErrorRate: config.maxErrorRate }) : null;
      send(200, { ok: true, latest: run, evaluation });
      return;
    }

    if (pathname === "/v1/admin/release/checklist" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const { checklist } = await computeReleaseChecklistState();
      send(200, { ok: true, pass: checklist.pass, checks: checklist.checks });
      return;
    }

    if (pathname === "/v1/admin/monitoring/errors" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const limitRaw = Number(url.searchParams.get("limit") || 50);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const errors = snapshotErrorCounters(limit);
      send(200, { ok: true, windowMinutes: Math.round(ERROR_WINDOW_MS / 60000), errors });
      return;
    }

    if (pathname === "/v1/admin/community/pending" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const items = await listCommunityPending(page, pageSize);
      send(200, { ok: true, items, page, pageSize });
      return;
    }

    const communityModerateMatch = pathname.match(/^\/v1\/admin\/community\/([^/]+)\/(approve|reject)$/);
    if (communityModerateMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const id = communityModerateMatch[1];
      const action = communityModerateMatch[2];
      const status = action === "approve" ? "approved" : "rejected";
      const updated = await moderateCommunityResponse(id, status, userId);
      if (!updated) {
        sendError(res, 404, "not_found", "Response not found");
        return;
      }
      await auditAdmin(`community.${action}`, id, { status, resetItemId: updated.resetItemId });
      send(200, { ok: true, response: updated });
      return;
    }

    if (pathname === "/v1/admin/changelog" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const version = typeof body?.version === "string" ? body.version.trim() : "";
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
      const audienceRaw = typeof body?.audience === "string" ? body.audience.trim().toLowerCase() : "admin";
      const audience = audienceRaw === "user" ? "user" : "admin";
      if (!version) {
        sendError(res, 400, "version_required", "version is required", "version");
        return;
      }
      if (!title) {
        sendError(res, 400, "title_required", "title is required", "title");
        return;
      }
      if (!notes) {
        sendError(res, 400, "notes_required", "notes is required", "notes");
        return;
      }
      const entry = await insertChangelogEntry({ version, title, notes, audience });
      await auditAdmin("changelog.create", entry.id, { version, audience });
      send(200, { ok: true, entry });
      return;
    }

    if (pathname === "/v1/admin/changelog" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const pageRaw = Number(url.searchParams.get("page") || 1);
      const pageSizeRaw = Number(url.searchParams.get("pageSize") || 20);
      const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
      const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 100) : 20;
      const audienceParam = url.searchParams.get("audience");
      const audience = audienceParam === "user" || audienceParam === "admin" ? audienceParam : null;
      const items = await listChangelogEntries({ audience, page, pageSize });
      send(200, { ok: true, items, page, pageSize, audience });
      return;
    }

    if (pathname === "/v1/admin/flags" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const flags = await getFeatureFlags();
      send(200, { ok: true, flags });
      return;
    }

    if (pathname === "/v1/admin/flags" && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const key = body?.key;
      const value = body?.value;
      if (!key || typeof key !== "string") {
        sendError(res, 400, "key_required", "key is required", "key");
        return;
      }
      if (value == null) {
        sendError(res, 400, "value_required", "value is required", "value");
        return;
      }
      const updated = await setFeatureFlag(key, value);
      featureFlagsCache.data = null;
      await auditAdmin("flags.patch", key, { key, value: String(value) });
      send(200, { ok: true, flag: updated });
      return;
    }

    if (pathname === "/v1/admin/parameters" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const paramsState = await getParameters();
      send(200, {
        ok: true,
        parameters: paramsState.map,
        versions: paramsState.versions,
        errors: paramsState.errors,
      });
      return;
    }

    if (pathname === "/v1/admin/parameters" && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const key = body?.key;
      if (!key || typeof key !== "string") {
        sendError(res, 400, "key_required", "key is required", "key");
        return;
      }
      const defaults = getDefaultParameters();
      if (!(key in defaults)) {
        sendError(res, 400, "key_invalid", "Unknown parameter key", "key");
        return;
      }
      let value = body?.value;
      if (value == null && typeof body?.value_json === "string") {
        try {
          value = JSON.parse(body.value_json);
        } catch {
          sendError(res, 400, "value_invalid", "value_json must be valid JSON", "value_json");
          return;
        }
      }
      if (value == null) {
        sendError(res, 400, "value_required", "value is required", "value");
        return;
      }
      const updated = await upsertParameter(key, value);
      resetParametersCache();
      await auditAdmin("parameters.patch", key, { key });
      await insertOpsLog({ adminUserId: userId, action: "params_updated", target: key, props: { key } });
      send(200, { ok: true, key, version: updated.version, updatedAt: updated.updatedAt });
      return;
    }

    if (pathname === "/v1/admin/packs" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const packs = await listContentPacks();
      send(200, { ok: true, packs });
      return;
    }

    const packMatch = pathname.match(/^\/v1\/admin\/packs\/([^/]+)$/);
    if (packMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const packId = packMatch[1];
      const pack = await getContentPack(packId);
      if (!pack) {
        sendError(res, 404, "not_found", "Pack not found");
        return;
      }
      send(200, { ok: true, pack });
      return;
    }
    if (packMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const packId = packMatch[1];
      const body = await parseJson(req);
      const weights = parseMaybeJson(body.weights_json ?? body.weights, "weights");
      const constraints = parseMaybeJson(body.constraints_json ?? body.constraints, "constraints");
      if (!validatePackWeightsShape(weights)) {
        sendError(res, 400, "weights_invalid", "weights must include tag weight maps", "weights");
        return;
      }
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : packId;
      const updated = await upsertContentPack({ id: packId, name, weights, constraints });
      resetParametersCache();
      await auditAdmin("packs.patch", packId, { packId });
      await insertOpsLog({ adminUserId: userId, action: "pack_updated", target: packId, props: { packId } });
      send(200, { ok: true, pack: updated });
      return;
    }

    if (pathname === "/v1/admin/preview/matrix" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const flags = await getFeatureFlags();
      const paramsState = await getParameters();
      const stageMode = isStageModeRequest(req, url, email);
      const library = (await loadLibraryForStageMode(stageMode)) || domain.defaultLibrary;
      const ruleConfig = buildRuleConfig(res.livenewRequestId, userId);
      const packs = await listContentPacks();
      const packIds = Array.isArray(body.packIds) && body.packIds.length
        ? body.packIds.filter((id) => typeof id === "string")
        : packs.map((pack) => pack.id);
      const profiles = Array.isArray(body.profiles) && body.profiles.length
        ? body.profiles.filter((id) => typeof id === "string")
        : ALL_PROFILES.slice();
      const defaultBuckets = paramsState.map?.timeBuckets?.allowed || [5, 10, 15, 20, 30, 45, 60];
      const timeBuckets = Array.isArray(body.timeBuckets) && body.timeBuckets.length ? body.timeBuckets : defaultBuckets;
      const baseInputs = body.baseInputs || {};
      const baseSleep = Number(baseInputs.sleepQuality ?? 6);
      const baseStress = Number(baseInputs.stress ?? 5);
      const baseEnergy = Number(baseInputs.energy ?? 6);
      const matrix = [];
      const sortedProfiles = profiles.slice().sort();
      const sortedPacks = packIds.slice().sort();
      const sortedBuckets = timeBuckets.slice().map((n) => Number(n)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);

      for (const profile of sortedProfiles) {
        for (const packId of sortedPacks) {
          for (const timeAvailableMin of sortedBuckets) {
            const simulatedUser = normalizeUserProfile({
              contentPack: packId,
              timezone: DEFAULT_TIMEZONE,
              dayBoundaryHour: 4,
              preferredWorkoutWindows: ["PM"],
              busyDays: [],
            });
            const dateISO = getTodayISOForProfile(simulatedUser);
            const checkIn = {
              dateISO,
              stress: baseStress,
              sleepQuality: baseSleep,
              energy: baseEnergy,
              timeAvailableMin,
            };
            const toggles = resolveRuleToggles(normalizeState({ userProfile: simulatedUser }), flags);
            const qualityRules = qualityRulesFromToggles(toggles);
            const { dayPlan } = domain.buildDayPlan({
              user: simulatedUser,
              dateISO,
              checkIn,
              checkInsByDate: { [dateISO]: checkIn },
              completionsByDate: {},
              feedback: [],
              weekContext: { busyDays: simulatedUser.busyDays || [], recentNoveltyGroups: [] },
              overrides: { profileOverride: profile },
              qualityRules,
              params: paramsState.map,
              ruleConfig,
              library,
            });
            matrix.push({
              profile,
              timeAvailableMin,
              packId,
              picked: {
                workoutId: dayPlan?.workout?.id || null,
                resetId: dayPlan?.reset?.id || null,
                nutritionId: dayPlan?.nutrition?.id || null,
              },
              meta: {
                confidence: dayPlan?.meta?.confidence ?? null,
                relevance: dayPlan?.meta?.relevance ?? null,
                appliedRulesTop: (dayPlan?.meta?.appliedRules || []).slice(0, 3),
              },
            });
          }
        }
      }

      send(200, { ok: true, matrix, stageMode });
      return;
    }

    if (pathname === "/v1/admin/experiments" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const status = url.searchParams.get("status");
      const experiments = await listExperiments(status || null);
      send(200, { ok: true, experiments });
      return;
    }

    if (pathname === "/v1/admin/experiments" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;
      if (!name) {
        sendError(res, 400, "name_required", "name is required", "name");
        return;
      }
      const rawConfig = parseMaybeJson(body.config_json ?? body.config, "config_json");
      const configValidated = await validateExperimentConfig(rawConfig);
      const status = normalizeExperimentStatus(body.status);
      const experiment = await createExperiment({ name, config: configValidated, status });
      await auditAdmin("experiments.create", experiment.id, { status });
      send(200, { ok: true, experiment });
      return;
    }

    const experimentMatch = pathname.match(/^\/v1\/admin\/experiments\/([^/]+)$/);
    if (experimentMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const experiment = await getExperiment(experimentMatch[1]);
      if (!experiment) {
        sendError(res, 404, "not_found", "Experiment not found");
        return;
      }
      send(200, { ok: true, experiment });
      return;
    }
    if (experimentMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const experimentId = experimentMatch[1];
      const existing = await getExperiment(experimentId);
      if (!existing) {
        sendError(res, 404, "not_found", "Experiment not found");
        return;
      }
      const body = await parseJson(req);
      const patch = {};
      if (typeof body?.name === "string" && body.name.trim()) {
        patch.name = body.name.trim();
      }
      if (body?.status) {
        patch.status = normalizeExperimentStatus(body.status);
      }
      if (body?.config != null || body?.config_json != null) {
        const rawConfig = parseMaybeJson(body.config_json ?? body.config, "config_json");
        patch.config = await validateExperimentConfig(rawConfig);
      }
      if (!Object.keys(patch).length) {
        sendError(res, 400, "patch_empty", "No valid fields to update");
        return;
      }
      const experiment = await updateExperiment(experimentId, patch);
      await auditAdmin("experiments.patch", experimentId, { fields: Object.keys(patch) });
      send(200, { ok: true, experiment });
      return;
    }

    const experimentStartMatch = pathname.match(/^\/v1\/admin\/experiments\/([^/]+)\/start$/);
    if (experimentStartMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const experimentId = experimentStartMatch[1];
      const existing = await getExperiment(experimentId);
      if (!existing) {
        sendError(res, 404, "not_found", "Experiment not found");
        return;
      }
      await validateExperimentConfig(existing.config);
      const experiment = await setExperimentStatus(experimentId, "running");
      await auditAdmin("experiments.start", experimentId, {});
      await insertOpsLog({ adminUserId: userId, action: "experiment_started", target: experimentId, props: {} });
      send(200, { ok: true, experiment });
      return;
    }

    const experimentStopMatch = pathname.match(/^\/v1\/admin\/experiments\/([^/]+)\/stop$/);
    if (experimentStopMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const experimentId = experimentStopMatch[1];
      const existing = await getExperiment(experimentId);
      if (!existing) {
        sendError(res, 404, "not_found", "Experiment not found");
        return;
      }
      const experiment = await setExperimentStatus(experimentId, "stopped");
      await auditAdmin("experiments.stop", experimentId, {});
      await insertOpsLog({ adminUserId: userId, action: "experiment_stopped", target: experimentId, props: {} });
      send(200, { ok: true, experiment });
      return;
    }

    const experimentAssignmentsMatch = pathname.match(/^\/v1\/admin\/experiments\/([^/]+)\/assignments$/);
    if (experimentAssignmentsMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const experimentId = experimentAssignmentsMatch[1];
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const { items, total } = await listExperimentAssignments(experimentId, page, pageSize);
      send(200, { ok: true, experimentId, items, total, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/cohorts" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const cohorts = await listCohorts();
      send(200, { ok: true, cohorts });
      return;
    }

    const cohortParamsMatch = pathname.match(/^\/v1\/admin\/cohorts\/([^/]+)\/parameters$/);
    if (cohortParamsMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const cohortId = cohortParamsMatch[1];
      const params = await listCohortParameters(cohortId);
      send(200, { ok: true, cohortId, parameters: params });
      return;
    }
    if (cohortParamsMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const cohortId = cohortParamsMatch[1];
      const body = await parseJson(req);
      const key = body?.key;
      if (!key || typeof key !== "string") {
        sendError(res, 400, "key_required", "key is required", "key");
        return;
      }
      const defaults = getDefaultParameters();
      if (!(key in defaults)) {
        sendError(res, 400, "key_invalid", "Unknown parameter key", "key");
        return;
      }
      let value = body?.value;
      if (value == null && typeof body?.value_json === "string") {
        try {
          value = JSON.parse(body.value_json);
        } catch {
          sendError(res, 400, "value_invalid", "value_json must be valid JSON", "value_json");
          return;
        }
      }
      const updated = await upsertCohortParameter(cohortId, key, value);
      resetParametersCache();
      await auditAdmin("cohorts.parameters.patch", cohortId, { cohortId, key });
      send(200, { ok: true, cohortId, key, version: updated.version, updatedAt: updated.updatedAt });
      return;
    }

    const userCohortMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/cohort$/);
    if (userCohortMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const targetUserId = sanitizeUserId(userCohortMatch[1]);
      if (targetUserId !== userCohortMatch[1]) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const body = await parseJson(req);
      const cohortId = body?.cohortId;
      if (!cohortId || typeof cohortId !== "string") {
        sendError(res, 400, "cohort_required", "cohortId is required", "cohortId");
        return;
      }
      const result = await setUserCohort(targetUserId, cohortId, body?.overridden === true);
      await auditAdmin("users.cohort.patch", targetUserId, { cohortId });
      send(200, { ok: true, ...result });
      return;
    }

    if (pathname === "/v1/admin/users/search" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const emailQuery = url.searchParams.get("email");
      if (!emailQuery) {
        sendError(res, 400, "email_required", "email is required", "email");
        return;
      }
      const result = await searchUserByEmail(emailQuery);
      if (!result) {
        sendError(res, 404, "not_found", "User not found");
        return;
      }
      send(200, { ok: true, user: result });
      return;
    }

    const repinMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/repin-snapshot$/);
    if (repinMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const targetUserId = sanitizeUserId(repinMatch[1]);
      if (targetUserId !== repinMatch[1]) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const body = await parseJson(req);
      const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
      if (!snapshotId) {
        sendError(res, 400, "snapshot_required", "snapshotId is required", "snapshotId");
        return;
      }
      const snapshot = await getContentSnapshot(snapshotId);
      if (!snapshot) {
        sendError(res, 404, "not_found", "Snapshot not found");
        return;
      }
      const targetState = await getUserState(targetUserId);
      if (!targetState?.state) {
        sendError(res, 404, "not_found", "User state not found");
        return;
      }
      const userProfile = targetState.state.userProfile || null;
      const repin = await repinUserSnapshot({
        userId: targetUserId,
        snapshotId,
        userProfile,
        reason: body?.reason || "manual",
      });
      await auditAdmin("users.snapshot.repin", targetUserId, { snapshotId, reason: body?.reason || "manual" });
      send(200, { ok: true, userId: targetUserId, snapshotId, pinExpiresAt: repin?.pinExpiresAt || null });
      return;
    }

    const debugBundleMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/debug-bundle$/);
    if (debugBundleMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const targetUserId = sanitizeUserId(debugBundleMatch[1]);
      if (targetUserId !== debugBundleMatch[1]) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const snapshot = await getUserState(targetUserId);
      if (!snapshot?.state) {
        sendError(res, 404, "not_found", "User state not found");
        return;
      }
      let baseState = normalizeState(deepClone(snapshot.state));
      try {
        validateState(baseState);
      } catch {
        baseState = normalizeState({});
      }
      const events = await getUserEventsRecent(targetUserId, 30);
      const todayISO = getTodayISOForProfile(baseState.userProfile);
      const daySummaries = [];
      for (let i = 0; i < 7; i += 1) {
        const dateISO = domain.addDaysISO(todayISO, -i);
        const history = await listDayPlanHistory(targetUserId, dateISO, 1);
        if (history?.length) {
          daySummaries.push(summarizeDayContract(history[0].day));
        }
      }
      const stressKeys = Object.keys(baseState.lastStressStateByDate || {})
        .sort()
        .slice(-7);
      const stress = stressKeys.map((key) => ({
        dateISO: key,
        drivers: (baseState.lastStressStateByDate[key]?.drivers || []).slice(0, 4),
        recoveryDebt: baseState.lastStressStateByDate[key]?.recoveryDebt ?? null,
      }));
      const redacted = {
        userId: targetUserId,
        profile: redactSensitive(baseState.userProfile),
        checkIns: (baseState.checkIns || []).slice(0, 14).map(numericCheckIn),
        daySummaries,
        events: events
          .slice()
          .reverse()
          .map((evt) => ({ type: evt.type, atISO: evt.atISO, payload: redactSensitive(evt.payload) })),
        stress,
      };
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const bundle = await insertDebugBundle({ userId: targetUserId, expiresAt, redacted });
      await auditAdmin("users.debug_bundle.create", targetUserId, { bundleId: bundle.id });
      send(200, { ok: true, bundleId: bundle.id, expiresAt: bundle.expiresAt });
      return;
    }

    const debugBundleReadMatch = pathname.match(/^\/v1\/admin\/debug-bundles\/([^/]+)$/);
    if (debugBundleReadMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const bundleId = debugBundleReadMatch[1];
      const bundle = await getDebugBundle(bundleId);
      if (!bundle) {
        sendError(res, 404, "not_found", "Debug bundle not found");
        return;
      }
      send(200, { ok: true, bundle });
      return;
    }

    const replayMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/replay-sandbox$/);
    if (replayMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const targetUserId = sanitizeUserId(replayMatch[1]);
      if (targetUserId !== replayMatch[1]) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const snapshot = await getUserState(targetUserId);
      let sandboxState = normalizeState(deepClone(snapshot?.state || {}));
      try {
        validateState(sandboxState);
      } catch {
        sandboxState = normalizeState({});
      }
      const flags = await getFeatureFlags();
      const paramsState = await getParameters(targetUserId);
      const ruleConfig = buildRuleConfig(res.livenewRequestId, targetUserId);
      let experimentEffects = {
        paramsEffective: paramsState.map,
        packOverride: null,
        experimentMeta: null,
        assignments: [],
      };
      try {
        experimentEffects = await applyExperiments({
          userId: targetUserId,
          cohortId: paramsState.cohortId || null,
          params: paramsState.map,
          logger: ruleConfig.logger,
          persistAssignments: false,
        });
      } catch (err) {
        logError({
          event: "experiments_apply_failed",
          userId: targetUserId,
          requestId: res.livenewRequestId,
          error: err?.code || err?.message || String(err),
        });
      }
      const paramsMeta = {
        cohortId: paramsState.cohortId || null,
        versions: paramsState.versionsBySource || {},
        experiments: experimentEffects.assignments || [],
      };
      const paramsEffective = experimentEffects.paramsEffective || paramsState.map;
      const packOverride = experimentEffects.packOverride || null;
      const experimentMeta = experimentEffects.experimentMeta || null;
      const events = (await getUserEventsRecent(targetUserId, 30))
        .slice()
        .sort((a, b) => (a.atISO || "").localeCompare(b.atISO || ""));

      for (const evt of events) {
        const todayISO = dateISOForAt(sandboxState.userProfile, evt.atISO);
        const ctx = {
          domain,
          now: { todayISO, atISO: evt.atISO },
          ruleToggles: resolveRuleToggles(sandboxState, flags),
          scenarios: { getScenarioById },
          isDev: isDevRoutesEnabled,
          params: paramsEffective,
          paramsMeta,
          packOverride,
          experimentMeta,
          ruleConfig,
        };
        const resEvent = reduceEvent(sandboxState, { type: evt.type, payload: evt.payload, atISO: evt.atISO }, ctx);
        sandboxState = appendLogEvent(resEvent.nextState, resEvent.logEvent);
      }

      const sandboxTodayISO = getTodayISOForProfile(sandboxState.userProfile);
      const ensureCtx = {
        domain,
        now: { todayISO: sandboxTodayISO, atISO: new Date().toISOString() },
        ruleToggles: resolveRuleToggles(sandboxState, flags),
        scenarios: { getScenarioById },
        isDev: isDevRoutesEnabled,
        params: paramsEffective,
        paramsMeta,
        packOverride,
        experimentMeta,
        ruleConfig,
      };
      const ensured = reduceEvent(sandboxState, { type: "ENSURE_WEEK", payload: {}, atISO: ensureCtx.now.atISO }, ensureCtx);
      sandboxState = appendLogEvent(ensured.nextState, ensured.logEvent);

      const affectedDates = new Set([sandboxTodayISO]);
      events.forEach((evt) => {
        const dateISO = evt.payload?.dateISO || evt.payload?.checkIn?.dateISO;
        if (dateISO) affectedDates.add(dateISO);
      });

      const diffs = [];
      const dates = Array.from(affectedDates).sort();
      for (const dateISO of dates) {
        if (!sandboxState.weekPlan || !sandboxState.weekPlan.days?.some((day) => day.dateISO === dateISO)) {
          const rebuildCtx = {
            ...ensureCtx,
            now: { todayISO: dateISO, atISO: ensureCtx.now.atISO },
          };
          const rebuilt = reduceEvent(
            sandboxState,
            { type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO }, atISO: rebuildCtx.now.atISO },
            rebuildCtx
          );
          sandboxState = appendLogEvent(rebuilt.nextState, rebuilt.logEvent);
        }
        const history = await listDayPlanHistory(targetUserId, dateISO, 1);
        const storedDay = history?.[0]?.day || null;
        const sandboxDay = toDayContract(sandboxState, dateISO, domain);
        if (!storedDay || !sandboxDay) continue;
        const diff = diffDayContracts(storedDay, sandboxDay);
        if (diff.changes?.length) {
          diffs.push({
            dateISO,
            changeCount: diff.changes.length,
            changes: diff.changes.slice(0, 20),
          });
        }
      }

      let sandboxDay = null;
      try {
        sandboxDay = toDayContract(sandboxState, sandboxTodayISO, domain);
        assertDayContract(sandboxDay);
      } catch {
        sandboxDay = null;
      }

      await auditAdmin("users.replay_sandbox", targetUserId, { eventsReplayed: events.length });
      send(200, {
        ok: true,
        diffs,
        sandbox: {
          day: sandboxDay,
          summary: {
            eventsReplayed: events.length,
            affectedDates: dates,
            todayISO: sandboxTodayISO,
          },
        },
      });
      return;
    }

    if (pathname === "/v1/admin/metrics/latency" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const entries = Array.from(LATENCY_ROUTES).map((routeKey) => ({
        route: routeKey,
        ...latencyStats(routeKey),
      }));
      send(200, { ok: true, metrics: entries });
      return;
    }

    if (pathname === "/v1/admin/trace" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      const dateISO = url.searchParams.get("date");
      if (!userIdParam || !dateISO) {
        sendError(res, 400, "params_required", "userId and date are required");
        return;
      }
      const validation = validateDateParam(dateISO, "date");
      if (!validation.ok) {
        sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
        return;
      }
      const trace = await getDecisionTrace(userIdParam, dateISO);
      send(200, { ok: true, trace });
      return;
    }

    if (pathname === "/v1/admin/traces" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      const fromISO = url.searchParams.get("from");
      const toISO = url.searchParams.get("to");
      if (!userIdParam || !fromISO || !toISO) {
        sendError(res, 400, "params_required", "userId, from, and to are required");
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const traces = await listDecisionTraces(userIdParam, fromISO, toISO, page, pageSize);
      send(200, { ok: true, traces, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/events" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (!userIdParam) {
        sendError(res, 400, "userId_required", "userId is required", "userId");
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const events = await listUserEventsPaged(userIdParam, page, pageSize);
      send(200, { ok: true, events, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/content/draft" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const kind = normalizeContentKind(body?.kind);
      const item = body?.item;
      if (!kind) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      if (!item || typeof item !== "object") {
        sendError(res, 400, "item_invalid", "item is required", "item");
        return;
      }
      const id = item.id || crypto.randomUUID();
      const candidate = { ...item, id, kind, status: "draft" };
      validateContentItemOrThrow(kind, candidate, { allowDisabled: true });
      const saved = await upsertContentItem(kind, candidate, { status: "draft", updatedByAdmin: userId });
      await auditAdmin("content.draft", `${kind}:${saved.id}`, { kind, id: saved.id });
      send(200, { ok: true, item: saved });
      return;
    }

    if (pathname === "/v1/admin/content/from-outline" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const kind = normalizeContentKind(body?.kind);
      const outlineText = body?.outlineText;
      const suggestedTags = Array.isArray(body?.suggestedTags) ? body.suggestedTags : [];
      const minutesHint = body?.minutesHint;
      if (!kind) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      if (!outlineText || typeof outlineText !== "string") {
        sendError(res, 400, "outline_required", "outlineText is required", "outlineText");
        return;
      }
      const draftItem = outlineToContentItem({ kind, outlineText, suggestedTags, minutesHint });
      const report = runContentChecks([draftItem], { kind, scope: "draft" });
      const allowForce = config.isDevLike && url.searchParams.get("forceDraft") === "true";
      const previewOnly = url.searchParams.get("preview") === "true";
      if (report.errors.length && !allowForce && !previewOnly) {
        sendError(
          res,
          badRequest("invalid_content_item", "Content checks failed", "outlineText", {
            report,
            expose: true,
          })
        );
        return;
      }
      if (previewOnly) {
        send(200, { ok: true, draftItem, validationReport: report, saved: false });
        return;
      }
      if (!allowForce) {
        validateContentItemOrThrow(kind, draftItem, { allowDisabled: true });
      }
      const saved = await upsertContentItem(kind, draftItem, { status: "draft", updatedByAdmin: userId });
      await auditAdmin("content.from_outline", `${kind}:${saved.id}`, { kind, id: saved.id, forced: allowForce });
      send(200, { ok: true, draftItem: saved, validationReport: report });
      return;
    }

    const contentStageMatch = pathname.match(/^\/v1\/admin\/content\/stage\/(workout|nutrition|reset)\/([^/]+)$/);
    if (contentStageMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentStageMatch[1];
      const id = contentStageMatch[2];
      const { item, errors, warnings } = await runChecksForItem(kind, id);
      if (!item) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      validateContentItemOrThrow(kind, item, { allowDisabled: true });
      if (errors.length) {
        sendError(res, badRequest("invalid_content_item", "Content checks failed", "item", { errors, warnings }));
        return;
      }
      const staged = await setContentStatus(kind, id, "staged", userId);
      await auditAdmin("content.stage", `${kind}:${id}`, { kind, id, warnings });
      send(200, { ok: true, item: staged, warnings });
      return;
    }

    const contentEnableMatch = pathname.match(/^\/v1\/admin\/content\/enable\/(workout|nutrition|reset)\/([^/]+)$/);
    if (contentEnableMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentEnableMatch[1];
      const id = contentEnableMatch[2];
      const { item, errors, warnings } = await runChecksForItem(kind, id);
      if (!item) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      if (item.status !== "staged") {
        sendError(res, 409, "content_not_staged", "Item must be staged before enabling");
        return;
      }
      if (errors.length) {
        sendError(res, badRequest("invalid_content_item", "Content checks failed", "item", { errors, warnings }));
        return;
      }
      const enabledItem = await setContentStatus(kind, id, "enabled", userId);
      await applyLibraryFromDb();
      await auditAdmin("content.enable", `${kind}:${id}`, { kind, id, warnings });
      send(200, { ok: true, item: enabledItem, warnings });
      return;
    }

    const contentDisableSupplyMatch = pathname.match(/^\/v1\/admin\/content\/disable\/(workout|nutrition|reset)\/([^/]+)$/);
    if (contentDisableSupplyMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentDisableSupplyMatch[1];
      const id = contentDisableSupplyMatch[2];
      if (REQUIRED_CONTENT_IDS.has(id)) {
        sendError(res, 400, "required_content", "This item cannot be disabled");
        return;
      }
      const existing = await getContentItem(kind, id);
      if (!existing) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      const disabledItem = await setContentStatus(kind, id, "disabled", userId);
      await applyLibraryFromDb();
      await auditAdmin("content.disable", `${kind}:${id}`, { kind, id });
      send(200, { ok: true, item: disabledItem });
      return;
    }

    if (pathname === "/v1/admin/content/validate" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const scope = typeof body?.scope === "string" ? body.scope : "all";
      const statuses = statusesForScope(scope);
      const items = await listContentItems(undefined, true, { statuses });
      const report = runContentChecks(items, { kind: "all", scope });
      const savedReport = await insertContentValidationReport({ kind: "all", scope, report });
      await auditAdmin("content.validate", scope, { scope, errors: report.errors.length, warnings: report.warnings.length });
      send(200, { ok: true, scope, report, reportId: savedReport.id, atISO: savedReport.atISO });
      return;
    }

    if (pathname === "/v1/admin/content/validation-reports" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const limit = Number(url.searchParams.get("limit") || 20);
      const reports = await listContentValidationReports({ limit });
      send(200, { ok: true, reports });
      return;
    }

    const contentDisableMatch = pathname.match(/^\/v1\/admin\/content\/(workout|nutrition|reset)\/([^/]+)\/disable$/);
    if (contentDisableMatch && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentDisableMatch[1];
      const id = contentDisableMatch[2];
      if (REQUIRED_CONTENT_IDS.has(id)) {
        sendError(res, 400, "required_content", "This item cannot be disabled");
        return;
      }
      const existing = await getContentItem(kind, id);
      if (!existing) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      const updated = await setContentStatus(kind, id, "disabled", userId);
      await applyLibraryFromDb();
      await auditAdmin("content.disable", `${kind}:${id}`, { kind, id });
      send(200, { ok: true, item: updated });
      return;
    }

    const contentPatchMatch = pathname.match(/^\/v1\/admin\/content\/(workout|nutrition|reset)\/([^/]+)$/);
    if (contentPatchMatch && req.method === "PATCH") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = contentPatchMatch[1];
      const id = contentPatchMatch[2];
      const body = await parseJson(req);
      const allowed = [
        "enabled",
        "priority",
        "noveltyGroup",
        "tags",
        "minutes",
        "steps",
        "priorities",
        "title",
        "contraindications",
        "equipment",
        "idealTimeOfDay",
      ];
      const patch = {};
      allowed.forEach((key) => {
        if (key in body) patch[key] = body[key];
      });
      if (REQUIRED_CONTENT_IDS.has(id) && patch.enabled === false) {
        sendError(res, 400, "required_content", "This item cannot be disabled", "enabled");
        return;
      }
      if ("enabled" in patch && typeof patch.enabled !== "boolean") {
        sendError(res, 400, "field_invalid", "enabled must be boolean", "enabled");
        return;
      }
      if ("priority" in patch && !Number.isFinite(Number(patch.priority))) {
        sendError(res, 400, "field_invalid", "priority must be number", "priority");
        return;
      }
      if ("noveltyGroup" in patch && patch.noveltyGroup != null && typeof patch.noveltyGroup !== "string") {
        sendError(res, 400, "field_invalid", "noveltyGroup must be string", "noveltyGroup");
        return;
      }
      if ("tags" in patch && !Array.isArray(patch.tags)) {
        sendError(res, 400, "field_invalid", "tags must be array", "tags");
        return;
      }
      if ("steps" in patch && !Array.isArray(patch.steps)) {
        sendError(res, 400, "field_invalid", "steps must be array", "steps");
        return;
      }
      if ("priorities" in patch && !Array.isArray(patch.priorities)) {
        sendError(res, 400, "field_invalid", "priorities must be array", "priorities");
        return;
      }
      if ("contraindications" in patch && !Array.isArray(patch.contraindications)) {
        sendError(res, 400, "field_invalid", "contraindications must be array", "contraindications");
        return;
      }
      if ("equipment" in patch && !Array.isArray(patch.equipment)) {
        sendError(res, 400, "field_invalid", "equipment must be array", "equipment");
        return;
      }
      if ("idealTimeOfDay" in patch && !Array.isArray(patch.idealTimeOfDay)) {
        sendError(res, 400, "field_invalid", "idealTimeOfDay must be array", "idealTimeOfDay");
        return;
      }
      if ("minutes" in patch && !Number.isFinite(Number(patch.minutes))) {
        sendError(res, 400, "field_invalid", "minutes must be number", "minutes");
        return;
      }
      const existing = await getContentItem(kind, id);
      if (!existing) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      const merged = { ...existing, ...patch, id, kind };
      validateContentItemOrThrow(kind, merged, { allowDisabled: true });
      const updated = await patchContentItem(kind, id, patch, { updatedByAdmin: userId });
      if (!updated) {
        sendError(res, 404, "not_found", "Content item not found");
        return;
      }
      await applyLibraryFromDb();
      await auditAdmin("content.patch", `${kind}:${id}`, { kind, id, fields: Object.keys(patch) });
      send(200, { ok: true, item: updated });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      const statusParam = url.searchParams.get("status");
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const statuses = statusParam ? statusesForScope(statusParam) : Array.from(getContentStatuses());
      const items = await listContentItemsPaged(kind || undefined, page, pageSize, { statuses });
      send(200, { ok: true, items, page, pageSize, statuses });
      return;
    }

    if (pathname === "/v1/admin/reminders" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const dateISO = url.searchParams.get("date");
      if (dateISO) {
        const validation = validateDateParam(dateISO, "date");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      const status = url.searchParams.get("status");
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const items = await listReminderIntentsAdmin({ dateISO, status, page, pageSize });
      send(200, { ok: true, items, page, pageSize });
      return;
    }

    if (pathname === "/v1/admin/content" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const kind = body?.kind;
      const item = body?.item;
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      if (!item || typeof item !== "object") {
        sendError(res, 400, "item_invalid", "item is required", "item");
        return;
      }
      const id = item.id || crypto.randomUUID();
      const candidate = { ...item, id, kind, enabled: true };
      validateContentItemOrThrow(kind, candidate);
      const saved = await upsertContentItem(kind, candidate, { status: "enabled", updatedByAdmin: userId });
      await applyLibraryFromDb();
      await auditAdmin("content.create", `${kind}:${saved.id}`, { kind, id: saved.id });
      send(200, { ok: true, item: saved });
      return;
    }

    if (pathname === "/v1/admin/content/bulk" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const items = body?.items;
      if (!Array.isArray(items) || !items.length) {
        sendError(res, 400, "items_invalid", "items must be a non-empty array", "items");
        return;
      }
      const candidates = [];
      for (const entry of items) {
        const kind = entry?.kind;
        const item = entry?.item;
        if (!["workout", "nutrition", "reset"].includes(kind) || !item) {
          sendError(res, 400, "items_invalid", "Each item must include kind and item");
          return;
        }
        const id = item.id || crypto.randomUUID();
        const candidate = { ...item, id, kind, enabled: true };
        validateContentItemOrThrow(kind, candidate);
        candidates.push({ kind, candidate });
      }
      const saved = [];
      for (const { kind, candidate } of candidates) {
        const record = await upsertContentItem(kind, candidate, { status: "enabled", updatedByAdmin: userId });
        saved.push(record);
      }
      await applyLibraryFromDb();
      await auditAdmin("content.bulk", "content", { count: saved.length });
      send(200, { ok: true, items: saved });
      return;
    }

    if (pathname === "/v1/admin/stats/content" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      const fromISO = url.searchParams.get("from");
      const toISO = url.searchParams.get("to");
      if (fromISO) {
        const validation = validateDateParam(fromISO, "from");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      if (toISO) {
        const validation = validateDateParam(toISO, "to");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
      }
      const statsRows = await getAdminStats();
      const statsMap = new Map();
      statsRows.forEach((row) => {
        statsMap.set(row.itemId, row);
      });
      const items = await listContentItems(kind, true);
      const enriched = items.map((item) => {
        const stat = statsMap.get(item.id) || { picked: 0, completed: 0, notRelevant: 0 };
        const picked = stat.picked || 0;
        const completionRate = picked ? stat.completed / picked : 0;
        const notRelevantRate = picked ? stat.notRelevant / picked : 0;
        return {
          item,
          stats: {
            picked,
            completed: stat.completed || 0,
            notRelevant: stat.notRelevant || 0,
            completionRate,
            notRelevantRate,
          },
        };
      });
      send(200, { ok: true, kind, fromISO, toISO, items: enriched });
      return;
    }

    if (pathname === "/v1/admin/stats" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (userIdParam) {
        const sanitized = sanitizeUserId(userIdParam);
        if (sanitized !== userIdParam) {
          sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
          return;
        }
        const stats = await getContentStats(userIdParam);
        send(200, { ok: true, userId: userIdParam, stats });
        return;
      }
      const stats = await getAdminStats();
      send(200, { ok: true, stats });
      return;
    }

    if (pathname === "/v1/admin/analytics/daily" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      let fromISO = url.searchParams.get("from");
      let toISO = url.searchParams.get("to");
      if (!fromISO || !toISO) {
        const range = defaultDateRange(14);
        fromISO = fromISO || range.fromISO;
        toISO = toISO || range.toISO;
      }
      const fromValidation = validateDateParam(fromISO, "from");
      if (!fromValidation.ok) {
        sendError(res, 400, fromValidation.error.code, fromValidation.error.message, fromValidation.error.field);
        return;
      }
      const toValidation = validateDateParam(toISO, "to");
      if (!toValidation.ok) {
        sendError(res, 400, toValidation.error.code, toValidation.error.message, toValidation.error.field);
        return;
      }
      const days = await listAnalyticsDaily(fromISO, toISO);
      send(200, { ok: true, fromISO, toISO, days });
      return;
    }

    if (pathname === "/v1/admin/reports/worst-items" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const kind = url.searchParams.get("kind");
      if (!["workout", "nutrition", "reset"].includes(kind)) {
        sendError(res, 400, "kind_invalid", "kind must be workout, nutrition, or reset", "kind");
        return;
      }
      const limitRaw = Number(url.searchParams.get("limit") || 20);
      const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 100) : 20;
      const items = await getWorstItems(kind, limit);
      send(200, { ok: true, kind, limit, items });
      return;
    }

    if (pathname === "/v1/admin/reports/weekly-content" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const statsRows = await getAdminStats();
      const statsMap = buildContentStatsMap(statsRows);
      const kinds = ["workout", "nutrition", "reset"];
      const worstByKind = {};
      const topByKind = {};
      const disableCandidates = [];
      const addNeededTags = [];
      const itemsByKind = {};

      for (const kind of kinds) {
        const items = await listContentItems(kind, true);
        itemsByKind[kind] = items;
        const enriched = enrichContentItems(items, statsMap);
        const worstCount = Math.max(1, Math.ceil(enriched.length * 0.1));
        const worst = sortWorstItems(enriched).slice(0, worstCount);
        const top = sortTopItems(enriched).slice(0, 10);
        const summarizedWorst = worst.map((entry) => ({
          item: {
            id: entry.item.id,
            title: entry.item.title,
            tags: entry.item.tags,
            priority: entry.item.priority,
            noveltyGroup: entry.item.noveltyGroup,
            enabled: entry.item.enabled !== false,
          },
          stats: entry.stats,
        }));
        const summarizedTop = top.map((entry) => ({
          item: {
            id: entry.item.id,
            title: entry.item.title,
            tags: entry.item.tags,
            priority: entry.item.priority,
            noveltyGroup: entry.item.noveltyGroup,
            enabled: entry.item.enabled !== false,
          },
          stats: entry.stats,
        }));
        worstByKind[kind] = summarizedWorst;
        topByKind[kind] = summarizedTop;
        summarizedWorst.forEach((entry) => {
          if (entry.stats.picked >= 5 && entry.stats.notRelevantRate >= 0.35) {
            disableCandidates.push({
              kind,
              id: entry.item.id,
              reason: "High not-relevant rate",
            });
          }
        });
        const tagSuggestions = buildTagSuggestions(top);
        tagSuggestions.forEach((suggestion) => {
          addNeededTags.push({
            kind,
            tag: suggestion.tag,
            reason: "High completion rate among top performers",
          });
        });
      }

      const paramsState = await getParameters();
      const packWeights = paramsState.map?.contentPackWeights || getDefaultParameters().contentPackWeights;
      const packStats = buildPackStats(packWeights, itemsByKind, statsMap);

      send(200, {
        ok: true,
        report: {
          worstByKind,
          topByKind,
          packStats,
          suggestedActions: {
            disableCandidates,
            addNeededTags,
          },
        },
      });
      return;
    }

    if (pathname === "/v1/admin/actions/disable-items" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) {
        sendError(res, 400, "items_invalid", "items must be a non-empty array", "items");
        return;
      }
      const results = [];
      for (const entry of items) {
        const kind = entry?.kind;
        const id = entry?.id;
        if (!["workout", "nutrition", "reset"].includes(kind) || !id) {
          results.push({ kind, id, ok: false, error: "invalid_item" });
          continue;
        }
        if (REQUIRED_CONTENT_IDS.has(id)) {
          results.push({ kind, id, ok: false, error: "required_content" });
          continue;
        }
        const updated = await patchContentItem(kind, id, { enabled: false });
        results.push({ kind, id, ok: Boolean(updated) });
      }
      await applyLibraryFromDb();
      await auditAdmin("actions.disable_items", "content", { count: results.length });
      send(200, { ok: true, results });
      return;
    }

    if (pathname === "/v1/admin/actions/bump-priority" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) {
        sendError(res, 400, "items_invalid", "items must be a non-empty array", "items");
        return;
      }
      const results = [];
      for (const entry of items) {
        const kind = entry?.kind;
        const id = entry?.id;
        const delta = Number(entry?.delta || 0);
        if (!["workout", "nutrition", "reset"].includes(kind) || !id || !Number.isFinite(delta)) {
          results.push({ kind, id, ok: false, error: "invalid_item" });
          continue;
        }
        const itemsList = await listContentItems(kind, true);
        const current = itemsList.find((item) => item.id === id);
        if (!current) {
          results.push({ kind, id, ok: false, error: "not_found" });
          continue;
        }
        const nextPriority = Number(current.priority || 0) + delta;
        const updated = await patchContentItem(kind, id, { priority: nextPriority });
        results.push({ kind, id, ok: Boolean(updated), priority: nextPriority });
      }
      await applyLibraryFromDb();
      await auditAdmin("actions.bump_priority", "content", { count: results.length });
      send(200, { ok: true, results });
      return;
    }

    if (pathname === "/v1/admin/db/backup" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const backup = await createBackup();
      await auditAdmin("db.backup", backup?.id || "backup", {});
      send(200, { ok: true, backup });
      return;
    }

    if (pathname === "/v1/admin/db/restore" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const backupId = body?.backupId;
      if (!backupId || typeof backupId !== "string") {
        sendError(res, 400, "backupId_required", "backupId is required", "backupId");
        return;
      }
      const backups = await listBackups();
      if (!backups.includes(backupId)) {
        sendError(res, 404, "backup_not_found", "backupId not found", "backupId");
        return;
      }
      const restored = await restoreBackup(backupId);
      await auditAdmin("db.restore", backupId, {});
      send(200, { ok: true, backupId: restored.backupId });
      return;
    }

    if (pathname === "/v1/admin/tasks/run" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const task = body?.task;
      if (!["backup", "cleanup"].includes(task)) {
        sendError(res, 400, "task_invalid", "task must be backup or cleanup", "task");
        return;
      }
      const result = await taskScheduler.runTask(task);
      await auditAdmin("tasks.run", task, {});
      send(200, { ok: true, task, result });
      return;
    }

    if (pathname === "/v1/admin/repair" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const userIdParam = url.searchParams.get("userId");
      if (!userIdParam) {
        sendError(res, 400, "userId_required", "userId is required", "userId");
        return;
      }
      const sanitized = sanitizeUserId(userIdParam);
      if (sanitized !== userIdParam) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const repaired = await repairUserState(userIdParam, "manual_admin");
      if (!repaired.repaired) {
        sendError(res, 500, "repair_failed", "Unable to repair user state");
        return;
      }
      await auditAdmin("repair.user", userIdParam, { method: repaired.method });
      send(200, { ok: true, repaired: true, userId: userIdParam });
      return;
    }

    if (isDevRoutesEnabled) {
      if (pathname === "/v1/dev/replay" && req.method === "POST") {
        const body = await parseJson(req);
        const validation = validateReplay(body);
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const replayUserId = sanitizeUserId(validation.value.userId || userId);
        res.livenewUserId = replayUserId;

        let replayState = normalizeState(validation.value.initialState || {});
        const nowAtISO = new Date().toISOString();
        const now = { atISO: nowAtISO, todayISO: dateISOForAt(replayState.userProfile, nowAtISO) };
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();
        const ruleConfig = buildRuleConfig(res.livenewRequestId, replayUserId);
        const paramsMeta = { cohortId: null, versions: paramsState.versionsBySource || {}, experiments: [] };

        for (const evt of validation.value.events) {
          const atISO = evt.atISO || now.atISO;
          const todayISO = dateISOForAt(replayState.userProfile, atISO);
          const ctx = {
            domain,
            now: { todayISO, atISO },
            ruleToggles: resolveRuleToggles(replayState, flags),
            scenarios: { getScenarioById },
            isDev: true,
            params: paramsState.map,
            paramsMeta,
            ruleConfig,
          };
          const result = reduceEvent(replayState, { type: evt.type, payload: evt.payload, atISO }, ctx);
          replayState = appendLogEvent(result.nextState, result.logEvent);
        }

        const finalTodayISO = dateISOForAt(replayState.userProfile, now.atISO);
        const day = toDayContract(replayState, finalTodayISO, domain);
        const progress = domain.computeProgress({
          checkIns: replayState.checkIns || [],
          weekPlan: replayState.weekPlan,
          completions: replayState.partCompletionByDate || {},
        });
        const finalStateSummary = {
          hasProfile: Boolean(replayState.userProfile),
          weekStartDateISO: replayState.weekPlan?.startDateISO || null,
          checkInsCount: replayState.checkIns?.length || 0,
          feedbackCount: replayState.feedback?.length || 0,
          modifiers: replayState.modifiers || {},
          ruleToggles: replayState.ruleToggles || {},
        };
        sendJson(res, 200, { ok: true, finalStateSummary, day, progress }, replayUserId);
        return;
      }

      if (pathname === "/v1/dev/trace" && req.method === "GET") {
        const dateISO = url.searchParams.get("date");
        if (!dateISO) {
          sendError(res, 400, "date_required", "date query param is required", "date");
          return;
        }
        const validation = validateDateParam(dateISO, "date");
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const trace = await getDecisionTrace(userId, dateISO);
        send(200, { ok: true, trace });
        return;
      }

      if (pathname === "/v1/dev/events" && req.method === "GET") {
        const userIdParam = url.searchParams.get("userId");
        const targetUserId = userIdParam ? sanitizeUserId(userIdParam) : userId;
        const page = Number(url.searchParams.get("page") || 0);
        const pageSize = Number(url.searchParams.get("pageSize") || 0);
        let events = [];
        if (page || pageSize) {
          events = await listUserEventsPaged(targetUserId, page || 1, pageSize || 50);
        } else {
          const fromSeq = Number(url.searchParams.get("fromSeq") || 1);
          const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
          events = await getUserEvents(targetUserId, fromSeq, limit);
        }
        send(200, { ok: true, events, userId: targetUserId });
        return;
      }

      if (pathname === "/v1/dev/rewind" && req.method === "POST") {
        const body = await parseJson(req);
        const targetUserId = sanitizeUserId(body?.userId || userId);
        const seq = Number(body?.seq);
        if (!Number.isInteger(seq) || seq < 0) {
          sendError(res, 400, "seq_invalid", "seq must be a non-negative integer", "seq");
          return;
        }
        const events = seq === 0 ? [] : await getUserEvents(targetUserId, 1, seq);
        let rebuilt = normalizeState({});
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();
        const ruleConfig = buildRuleConfig(res.livenewRequestId, targetUserId);
        const paramsMeta = { cohortId: null, versions: paramsState.versionsBySource || {}, experiments: [] };
        for (const evt of events) {
          const todayISO = dateISOForAt(rebuilt.userProfile, evt.atISO);
          const ctx = {
            domain,
            now: { todayISO, atISO: evt.atISO },
            ruleToggles: resolveRuleToggles(rebuilt, flags),
            scenarios: { getScenarioById },
            isDev: true,
            params: paramsState.map,
            paramsMeta,
            ruleConfig,
          };
          const result = reduceEvent(rebuilt, { type: evt.type, payload: evt.payload, atISO: evt.atISO }, ctx);
          rebuilt = appendLogEvent(result.nextState, result.logEvent);
        }
        const latest = await loadUserState(targetUserId);
        const saveRes = await saveUserState(targetUserId, latest.version, rebuilt);
        if (!saveRes.ok) {
          sendError(res, 409, "state_conflict", "State conflict during rewind");
          return;
        }
        updateUserCache(targetUserId, rebuilt, saveRes.version);
        sendJson(res, 200, { ok: true, userId: targetUserId, version: saveRes.version }, targetUserId);
        return;
      }

      if (pathname === "/v1/dev/repair" && req.method === "POST") {
        const repaired = await repairUserState(userId, "manual_dev");
        if (!repaired.repaired) {
          sendError(res, 500, "repair_failed", "Unable to repair user state");
          return;
        }
        send(200, { ok: true, repaired: true });
        return;
      }

      if (pathname === "/v1/dev/content" && req.method === "GET") {
        const items = await listContentItems();
        if (items.length) {
          const workouts = items.filter((item) => item.kind === "workout");
          const nutrition = items.filter((item) => item.kind === "nutrition");
          const resets = items.filter((item) => item.kind === "reset");
          send(200, {
            ok: true,
            library: {
              workouts: summarizeLibraryItems(workouts),
              nutrition: summarizeLibraryItems(nutrition),
              resets: summarizeLibraryItems(resets),
            },
          });
          return;
        }
        const library = domain.defaultLibrary || {};
        send(200, {
          ok: true,
          library: {
            workouts: summarizeLibraryItems(library.workouts),
            nutrition: summarizeLibraryItems(library.nutrition),
            resets: summarizeLibraryItems(library.resets),
          },
        });
        return;
      }

      if (pathname === "/v1/dev/stats" && req.method === "GET") {
        const dbStats = await getContentStats(userId);
        send(200, { ok: true, selectionStats: state.selectionStats || {}, contentStats: dbStats });
        return;
      }

      if (pathname === "/v1/dev/bundle" && req.method === "GET") {
        const lastCheckIns = (state.checkIns || []).slice(0, 14);
        const stressKeys = Object.keys(state.lastStressStateByDate || {}).sort().slice(-7);
        const stressSubset = {};
        stressKeys.forEach((key) => {
          stressSubset[key] = state.lastStressStateByDate[key];
        });
        const flags = await getFeatureFlags();
        send(200, {
          ok: true,
          bundle: {
            versions: {
              pipelineVersion: state.weekPlan?.days?.[0]?.pipelineVersion ?? domain.DECISION_PIPELINE_VERSION ?? null,
              schemaVersion: state.schemaVersion ?? null,
            },
            userProfile: state.userProfile,
            weekPlan: state.weekPlan,
            checkIns: lastCheckIns,
            lastStressStateByDate: stressSubset,
            modifiers: state.modifiers,
            ruleToggles: state.ruleToggles,
            featureFlags: flags,
            eventLog: (state.eventLog || []).slice(0, 30),
          },
        });
        return;
      }

      if (pathname === "/v1/dev/rules" && req.method === "POST") {
        const body = await parseJson(req);
        const validation = validateRules(body);
        if (!validation.ok) {
          sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
          return;
        }
        const { ruleToggles } = validation.value;
        const { result } = await dispatchForUser({ type: "SET_RULE_TOGGLES", payload: { ruleToggles } });
        send(200, { ok: true, ruleToggles: result?.ruleToggles || state.ruleToggles });
        return;
      }

      if (pathname === "/v1/dev/scenario" && req.method === "POST") {
        const body = await parseJson(req);
        const scenarioId = body.scenarioId;
        await dispatchForUser({ type: "APPLY_SCENARIO", payload: { scenarioId } });
        const todayISO = getTodayISOForProfile(state.userProfile);
        const day = toDayContract(state, todayISO, domain);
        send(200, { ok: true, scenarioId, day });
        return;
      }

      if (pathname === "/v1/dev/snapshot/run" && req.method === "POST") {
        const body = await parseJson(req);
        const scenarioId = body.scenarioId;
        const allowParamDrift = body?.allowParamDrift === true;
        const ids = scenarioId ? [scenarioId] : SNAPSHOT_IDS;
        const results = [];
        const flags = await getFeatureFlags();
        const paramsState = await getParameters();
        for (const id of ids) {
          const resCheck = await runSnapshotCheck(id, state, {
            now: { todayISO: getTodayISOForProfile(state.userProfile), atISO: new Date().toISOString() },
            ruleToggles: resolveRuleToggles(state, flags),
            paramsVersion: paramsState.versions,
            params: paramsState.map,
            allowParamDrift,
          });
          results.push({ scenarioId: id, ok: resCheck.ok, diffsCount: resCheck.diffs.length });
        }
        send(200, { ok: true, results });
        return;
      }

      if (pathname === "/v1/dev/determinism/check" && req.method === "POST") {
        const body = await parseJson(req);
        const dateISO = body?.dateISO || getTodayISOForProfile(state.userProfile);
        if (dateISO) {
          const validation = validateDateParam(dateISO, "dateISO");
          if (!validation.ok) {
            sendError(res, 400, validation.error.code, validation.error.message, validation.error.field);
            return;
          }
        }
        const atISO = body?.atISO || new Date().toISOString();
        const snapshotCtx = await getSnapshotContext();
        const flags = await getFeatureFlags();
        const paramsState = await getParamsForUser();
        const ruleConfig = buildRuleConfig(res.livenewRequestId, userId);
        const contentPrefs = await loadContentPrefs(userId);
        let experimentEffects = {
          paramsEffective: paramsState.map,
          packOverride: null,
          experimentMeta: null,
          assignments: [],
        };
        try {
          experimentEffects = await applyExperiments({
            userId,
            cohortId: paramsState.cohortId || null,
            params: paramsState.map,
            logger: ruleConfig.logger,
          });
        } catch (err) {
          logError({
            event: "experiments_apply_failed",
            userId,
            requestId: res.livenewRequestId,
            error: err?.code || err?.message || String(err),
          });
        }
        const paramsMeta = {
          cohortId: paramsState.cohortId || null,
          versions: paramsState.versionsBySource || {},
          experiments: experimentEffects.assignments || [],
        };
        const paramsEffective = experimentEffects.paramsEffective || paramsState.map;
        const packOverride = experimentEffects.packOverride || null;
        const experimentMeta = experimentEffects.experimentMeta || null;
        const packId = packOverride || state.userProfile?.contentPack || null;
        const experimentIds = (experimentEffects.assignments || []).map(
          (assignment) => `${assignment.experimentId}:${assignment.variantKey}`
        );
        const modelStamp = buildModelStamp({
          snapshotId: snapshotCtx?.snapshotId || null,
          libraryHash: snapshotCtx?.snapshot?.libraryHash || null,
          packsHash: snapshotCtx?.snapshot?.packsHash || null,
          paramsVersions: paramsState.versions || {},
          packId,
          cohortId: paramsState.cohortId || null,
          experimentIds,
        });
        const incidentEnabled = resolveIncidentMode(flags);
        const ctxBase = {
          ruleToggles: resolveRuleToggles(state, flags),
          params: paramsEffective,
          paramsMeta,
          now: { todayISO: dateISO, atISO },
          incidentMode: incidentEnabled,
          engineGuards: resolveEngineGuards(flags, incidentEnabled),
          packOverride,
          experimentMeta,
          ruleConfig,
          preferences: contentPrefs,
          library: snapshotCtx?.library || domain.defaultLibrary,
          modelStamp,
        };

        const normalizeDayForHash = (day) => {
          if (!day) return day;
          const cloned = deepClone(day);
          if (cloned?.why?.meta) {
            delete cloned.why.meta.generatedAtISO;
            delete cloned.why.meta.generatedAt;
          }
          return cloned;
        };

        const runOnce = () => {
          let next = normalizeState(deepClone(state));
          let resEnsure = dispatch(next, { type: "ENSURE_WEEK", payload: {}, atISO }, ctxBase);
          next = resEnsure.state;
          if (dateISO && !next.weekPlan?.days?.some((day) => day.dateISO === dateISO)) {
            resEnsure = dispatch(next, { type: "WEEK_REBUILD", payload: { weekAnchorISO: dateISO }, atISO }, ctxBase);
            next = resEnsure.state;
          } else {
            resEnsure = dispatch(next, { type: "ENSURE_WEEK", payload: {}, atISO }, ctxBase);
            next = resEnsure.state;
          }
          const day = toDayContract(next, dateISO, domain);
          const normalized = normalizeDayForHash(day);
          return { day, hash: hashJSON(normalized) };
        };

        const runA = runOnce();
        const runB = runOnce();
        send(200, {
          ok: true,
          dateISO,
          hashA: runA.hash,
          hashB: runB.hash,
          match: runA.hash === runB.hash,
          day: runA.day,
        });
        return;
      }
    }

    sendError(res, 404, "not_found", "Not found");
  } catch (err) {
    if (NODE_ENV !== "production") {
      logError({
        atISO: new Date().toISOString(),
        errorCode: err?.code || "server_error",
        stack: err?.stack,
      });
    }
    sendError(res, err, undefined, undefined, undefined, res?.livenewRequestId);
  }
  });
});

server.listen(PORT, () => {
  logInfo(`LiveNew server listening on http://localhost:${PORT}`);
});

server.requestTimeout = 15000;
server.timeout = 15000;

async function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo(`LiveNew shutting down (${signal})...`);
  taskScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
