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
import { logInfo, logWarn, logError, logDebug } from "./logger.js";
import { assertDayContract, assertWeekPlan } from "./invariants.js";
import { validateWorkoutItem, validateResetItem, validateNutritionItem } from "../domain/content/validateContent.js";
import { runContentChecks } from "../domain/content/checks.js";
import { hashJSON, sanitizeContentItem, sanitizePack } from "../domain/content/snapshotHash.js";
import { buildModelStamp } from "../domain/planning/modelStamp.js";
import { buildToday, getLibrarySnapshot } from "../domain/planner.js";
import { buildWeekSkeleton } from "../domain/weekPlanner.js";
import { computeContinuityMeta } from "../domain/continuity.js";
import { applyQuickSignal } from "../domain/swap.js";
import { LIB_VERSION } from "../domain/libraryVersion.js";
import { weekStartMonday, addDaysISO } from "../domain/utils/date.js";
import { computeLoadCapacity } from "../domain/scoring.js";
import { assignProfile } from "../domain/profiles.js";
import { assertTodayContract } from "../contracts/todayContract.js";
import { assertBootstrapContract } from "../contracts/bootstrapContract.js";
import { unwrapTodayEnvelope } from "../contracts/protocol.js";
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
  getDbConfig,
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
  countPlanChangeSummariesInRange,
  insertChangelogEntry,
  listChangelogEntries,
  upsertReminderIntent,
  listReminderIntentsByDate,
  listReminderIntentsByRange,
  updateReminderIntentStatus,
  listReminderIntentsAdmin,
  getQualityMetricsRange,
  upsertAnalyticsUserDayTimes,
  listDay3RetentionRows,
  listUserStatesByIds,
  getStabilityDistribution,
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
  getUserConsentVersion,
  getUserBaseline,
  upsertUserBaseline,
  getDailyCheckIn,
  upsertDailyCheckIn,
  insertDailyEvent,
  insertDailyEventOnce,
  listDailyEvents,
  getDayState,
  upsertDayState,
  getWeekState,
  getWeekDaySeed,
  replaceWeekState,
  getIdempotencyRecord,
  insertIdempotencyRecord,
  setIdempotencyResponse,
  getConsentMeta,
  setConsentMeta,
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
  getUserSnapshotPin,
  upsertUserSnapshotPin,
  insertOpsRun,
  getLatestOpsRun,
  insertOpsLog,
  listLatestDayPlanHistoryByRange,
  runWithQueryTracker,
  getQueryStats,
  getTopQueries,
  explainQueryPlan,
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
import { runLoadtestScript, evaluateLoadtestReport } from "./ops.js";
import { buildReleaseChecklist } from "./releaseChecklist.js";
import { alphaReadiness } from "./releasePolicy.js";
import { diffSnapshots } from "./snapshotDiff.js";
import { loadSnapshotBundle, resolveSnapshotForUser, setDefaultSnapshotId, getDefaultSnapshotId, repinUserSnapshot, clearSnapshotCache, getSnapshotCacheStats } from "./snapshots.js";
import { scheduleStartupSmoke } from "./startupSmoke.js";
import { getEnvPolicy } from "./envPolicy.js";
import { getDateKey, getDateRangeKeys } from "../utils/dateKey.js";
import { createParityCounters } from "./parityCounters.js";
import { CONTRACT_LOCK_HASHES, DOMAIN_LOCK_HASHES } from "./lockHashes.js";
import { verifyHashes } from "./lockChecks.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const config = getConfig();
const canaryAllowlist = config.canaryAllowlist || new Set();
const envPolicy = getEnvPolicy(config.envMode);
const PORT = config.port;
const isDevRoutesEnabled = envPolicy.allowDevRoutes && config.devRoutesEnabled;
const EVENT_SOURCING = process.env.EVENT_SOURCING === "true";
const EVENT_RETENTION_DAYS = Number(process.env.EVENT_RETENTION_DAYS || 90);
const TEST_MODE = process.env.TEST_MODE === "true";
const runtimeAdminEmails = config.adminEmails;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const PARITY_LOG_EVERY_RAW = Number(process.env.PARITY_LOG_EVERY || 200);
const PARITY_LOG_EVERY = Number.isFinite(PARITY_LOG_EVERY_RAW) ? Math.max(0, PARITY_LOG_EVERY_RAW) : 200;
const PARITY_LOG_INTERVAL_RAW = Number(process.env.PARITY_LOG_INTERVAL_MS || 5 * 60 * 1000);
const PARITY_LOG_INTERVAL_MS = Number.isFinite(PARITY_LOG_INTERVAL_RAW) ? Math.max(0, PARITY_LOG_INTERVAL_RAW) : 5 * 60 * 1000;
const REQUIRED_EVIDENCE_ENV = "REQUIRED_EVIDENCE_ID";

function enforceLibVersionFreeze() {
  if (process.env.FREEZE_LIB_VERSION !== "true") return;
  const expected = (process.env.EXPECTED_LIB_VERSION || "").trim();
  if (!expected) {
    logError({ event: "lib_version_freeze_missing", message: "EXPECTED_LIB_VERSION is required when FREEZE_LIB_VERSION=true" });
    process.exit(1);
  }
  if (String(LIB_VERSION) !== expected) {
    logError({
      event: "lib_version_mismatch",
      expected,
      actual: String(LIB_VERSION),
    });
    process.exit(1);
  }
}

async function enforceLaunchLocks() {
  const rootDir = process.cwd();
  const evidence = process.env[REQUIRED_EVIDENCE_ENV] || null;

  const check = async (kind, expected) => {
    const result = await verifyHashes({ rootDir, expected, kind });
    if (result.ok) return;
    logError({
      event: `${kind}_lock_mismatch`,
      requiredEvidenceEnv: REQUIRED_EVIDENCE_ENV,
      evidenceProvided: evidence,
      mismatches: result.mismatches,
    });
    if (!evidence) {
      process.exit(1);
    }
    logWarn({
      event: `${kind}_lock_override`,
      requiredEvidenceEnv: REQUIRED_EVIDENCE_ENV,
      evidenceProvided: evidence,
      mismatchCount: result.mismatches.length,
    });
  };

  if (process.env.CONTRACT_LOCK === "true") {
    await check("contract", CONTRACT_LOCK_HASHES);
  }
  if (process.env.DOMAIN_LOCK === "true") {
    await check("domain", DOMAIN_LOCK_HASHES);
  }
}

const PUBLIC_DIR = path.join(process.cwd(), "public");
const CITATIONS_PATH = path.join(PUBLIC_DIR, "citations.json");
const REQUIRED_CONTENT_IDS = new Set(["r_panic_mode"]);
const REQUIRED_CONSENTS = ["terms", "privacy", "alpha_processing"];
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const REQUIRED_CONSENT_VERSION_ENV = Number(process.env.REQUIRED_CONSENT_VERSION || "");
const CONSENT_VERSION_CACHE_TTL_MS = 30 * 1000;
const ALL_PROFILES = [
  "Balanced",
  "PoorSleep",
  "WiredOverstimulated",
  "DepletedBurnedOut",
  "RestlessAnxious",
];
const ROUTE_REGEX_PATTERNS = [
  "^/v1/content/prefs/([^/]+)$",
  "^/v1/community/resets/([^/]+)/respond$",
  "^/v1/community/resets/([^/]+)$",
  "^/v1/reminders/([^/]+)/(dismiss|complete)$",
  "^/v1/admin/validator/runs/([^/]+)$",
  "^/v1/admin/snapshots/([^/]+)/release$",
  "^/v1/admin/snapshots/([^/]+)/rollback$",
  "^/v1/admin/snapshots/([^/]+)$",
  "^/v1/admin/community/([^/]+)/(approve|reject)$",
  "^/v1/admin/packs/([^/]+)$",
  "^/v1/admin/experiments/([^/]+)$",
  "^/v1/admin/experiments/([^/]+)/start$",
  "^/v1/admin/experiments/([^/]+)/stop$",
  "^/v1/admin/experiments/([^/]+)/assignments$",
  "^/v1/admin/cohorts/([^/]+)/parameters$",
  "^/v1/admin/users/([^/]+)/cohort$",
  "^/v1/admin/users/([^/]+)/repin-snapshot$",
  "^/v1/admin/users/([^/]+)/debug-bundle$",
  "^/v1/admin/debug-bundles/([^/]+)$",
  "^/v1/admin/users/([^/]+)/replay-sandbox$",
  "^/v1/admin/content/stage/(workout|nutrition|reset)/([^/]+)$",
  "^/v1/admin/content/enable/(workout|nutrition|reset)/([^/]+)$",
  "^/v1/admin/content/disable/(workout|nutrition|reset)/([^/]+)$",
  "^/v1/admin/content/(workout|nutrition|reset)/([^/]+)/disable$",
  "^/v1/admin/content/(workout|nutrition|reset)/([^/]+)$",
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

function validateRouteRegexPatterns() {
  ROUTE_REGEX_PATTERNS.forEach((pattern) => {
    try {
      new RegExp(pattern);
    } catch (err) {
      throw new Error(`Invalid route regex pattern: ${pattern}`);
    }
  });
}

function recordRouteHit(method, pathname) {
  if (!TEST_MODE) return;
  const key = `${method} ${pathname}`;
  const count = routeHits.get(key) || 0;
  routeHits.set(key, count + 1);
}

const MONITOR_LOG_INTERVAL_MS = Math.max(0, Number(process.env.MONITOR_LOG_INTERVAL_MS || 60_000));

function bumpMonitoringCounter(key, inc = 1) {
  if (!key) return;
  const next = (monitoringCounters.get(key) || 0) + (Number(inc) || 0);
  monitoringCounters.set(key, next);
}

function flushMonitoringCounters(reason = "interval") {
  if (!monitoringCounters.size) return;
  const snapshot = {};
  for (const [key, value] of monitoringCounters.entries()) {
    if (value) snapshot[key] = value;
  }
  if (!Object.keys(snapshot).length) return;
  monitoringCounters.clear();
  logInfo({
    event: "monitoring_counters",
    reason,
    windowMs: MONITOR_LOG_INTERVAL_MS,
    counts: snapshot,
  });
}

if (MONITOR_LOG_INTERVAL_MS > 0) {
  setInterval(() => flushMonitoringCounters("interval"), MONITOR_LOG_INTERVAL_MS).unref();
}

let consentVersionCache = { value: 1, atMs: 0 };
async function getRequiredConsentVersion() {
  if (Number.isFinite(REQUIRED_CONSENT_VERSION_ENV) && REQUIRED_CONSENT_VERSION_ENV > 0) {
    return REQUIRED_CONSENT_VERSION_ENV;
  }
  const now = Date.now();
  if (consentVersionCache.value && now - consentVersionCache.atMs < CONSENT_VERSION_CACHE_TTL_MS) {
    return consentVersionCache.value;
  }
  try {
    const raw = await getConsentMeta("required_version");
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    consentVersionCache = { value, atMs: now };
    return value;
  } catch {
    return consentVersionCache.value || 1;
  }
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
const outcomesCache = new Map();
const contentPrefsCache = new Map();
const routeHits = new Map();
const startupSmokeStatus = { lastAtISO: null, ok: null, lastErrorCode: null };
const latencySamples = new Map();
const errorCounters = new Map();
const requestCounters = new Map();
let etagNotModifiedCount = 0;
const determinismCache = new Map();
const DETERMINISM_TTL_MS = 5 * 60 * 1000;
const idempotencyWarnCache = new Map();
const IDEMPOTENCY_WARN_WINDOW_MS = 60 * 1000;
const writeStormBuckets = new Map();
const monitoringCounters = new Map();
const parityCounters =
  PARITY_LOG_EVERY > 0 || PARITY_LOG_INTERVAL_MS > 0
    ? createParityCounters({ logEveryCount: PARITY_LOG_EVERY, logIntervalMs: PARITY_LOG_INTERVAL_MS, logFn: logInfo })
    : createParityCounters({ logEveryCount: 0, logIntervalMs: 0, logFn: null });
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

if (config.isDevLike) {
  validateRouteRegexPatterns();
}

const secretState = ensureSecretKey(config);

enforceLibVersionFreeze();
await enforceLaunchLocks();
await ensureDataDirWritable(config);
await initDb();
const dbConfig = getDbConfig();
logInfo({
  event: "db_config",
  path: getDbPath(),
  busyTimeoutMs: dbConfig.busyTimeoutMs,
  maxConnections: dbConfig.maxConnections,
});
try {
  const existingConsentVersion = await getConsentMeta("required_version");
  if (!existingConsentVersion) {
    await setConsentMeta("required_version", "1");
  }
} catch {
  // ignore consent meta boot failures
}
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
  loadSnapshotBundle,
  logInfo,
});

async function runEngineValidatorTask(options = {}) {
  const snapshotId = options.snapshotId || (await getDefaultSnapshotId());
  const report = await engineValidator({ ...options, snapshotId });
  const atISO = report.endedAt || new Date().toISOString();
  await insertValidatorRun({
    id: report.runId,
    kind: "engine_matrix",
    ok: report.ok,
    report,
    atISO,
    snapshotId: report?.meta?.snapshotId || snapshotId || null,
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
if (bootSummary.indexes && !bootSummary.indexes.ok) {
  logWarn({ event: "missing_indexes", missing: bootSummary.indexes.missing || [] });
}
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
  if (runtimeConfig.requireAuth && summary.indexes && !summary.indexes.ok) failures.push("DB_INDEXES");
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

function normalizeBaselineInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const timezone = typeof source.timezone === "string" ? source.timezone.trim() : "";
  const dayBoundaryHour = source.dayBoundaryHour ?? source.day_boundary_hour ?? source.boundaryHour ?? source.boundary;
  const constraints = source.constraints && typeof source.constraints === "object" ? source.constraints : null;
  return { timezone, dayBoundaryHour, constraints };
}

function validateBaselineInput(baseline) {
  if (!baseline?.timezone || !validateTimeZone(baseline.timezone)) {
    return { ok: false, error: { code: "timezone_invalid", message: "Valid timezone required", field: "timezone" } };
  }
  const hour = Number(baseline.dayBoundaryHour);
  if (!Number.isFinite(hour) || hour < 0 || hour > 6) {
    return { ok: false, error: { code: "day_boundary_invalid", message: "Valid day boundary required", field: "dayBoundaryHour" } };
  }
  return {
    ok: true,
    value: {
      timezone: baseline.timezone,
      dayBoundaryHour: Math.floor(hour),
      constraints: baseline.constraints || null,
    },
  };
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeCheckInInput(raw, dateISO) {
  const source = raw && typeof raw === "object" ? raw : {};
  const panic =
    typeof source?.panic === "boolean"
      ? source.panic
      : typeof source?.safety?.panic === "boolean"
        ? source.safety.panic
        : false;
  return {
    dateISO,
    stress: clampInt(source.stress, 1, 10, 5),
    sleepQuality: clampInt(source.sleepQuality, 1, 10, 6),
    energy: clampInt(source.energy, 1, 10, 6),
    timeAvailableMin: clampInt(source.timeAvailableMin, 5, 60, 10),
    safety: { panic },
  };
}

function validateCheckInPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: { code: "INVALID_CHECKIN", message: "checkIn payload required" } };
  }
  const rules = [
    { field: "stress", min: 1, max: 10 },
    { field: "sleepQuality", min: 1, max: 10 },
    { field: "energy", min: 1, max: 10 },
    { field: "timeAvailableMin", min: 5, max: 60 },
  ];
  for (const rule of rules) {
    const value = Number(raw[rule.field]);
    if (!Number.isFinite(value)) {
      return { ok: false, error: { code: "INVALID_CHECKIN", message: `checkIn.${rule.field} must be a number`, field: rule.field } };
    }
    if (value < rule.min || value > rule.max) {
      return { ok: false, error: { code: "INVALID_CHECKIN", message: `checkIn.${rule.field} out of range`, field: rule.field } };
    }
  }
  return { ok: true };
}

function hasUnexpectedKeys(payload, allowed) {
  if (!payload || typeof payload !== "object") return false;
  return Object.keys(payload).some((key) => !allowed.includes(key));
}

function validateEventPayload(type, payload) {
  if (type === "rail_opened") {
    const allowed = ["v"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    const body = payload && typeof payload === "object" ? payload : {};
    return { ok: true, payload: { v: Number(body.v || 1) || 1 } };
  }
  if (type === "reset_completed") {
    if (!payload || typeof payload !== "object") return { ok: true, payload: {} };
    const allowed = ["v", "resetId"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    if (payload.resetId && typeof payload.resetId !== "string") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "resetId invalid" } };
    }
    return { ok: true, payload: payload.resetId ? { v: 1, resetId: payload.resetId } : { v: 1 } };
  }
  if (type === "checkin_submitted") {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "checkin payload required" } };
    }
    const allowed = ["v", "stress", "sleep", "energy", "timeMin"];
    if (hasUnexpectedKeys(payload, allowed)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    const required = ["stress", "sleep", "energy", "timeMin"];
    for (const field of required) {
      const value = Number(payload[field]);
      if (!Number.isFinite(value)) {
        return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: `${field} invalid` } };
      }
    }
    if (payload.stress < 1 || payload.stress > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "stress out of range" } };
    }
    if (payload.sleep < 1 || payload.sleep > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "sleep out of range" } };
    }
    if (payload.energy < 1 || payload.energy > 10) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "energy out of range" } };
    }
    if (payload.timeMin < 5 || payload.timeMin > 60) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "timeMin out of range" } };
    }
    return {
      ok: true,
      payload: {
        v: 1,
        stress: payload.stress,
        sleep: payload.sleep,
        energy: payload.energy,
        timeMin: payload.timeMin,
      },
    };
  }
  if (type === "quick_adjusted") {
    if (!payload || typeof payload !== "object" || typeof payload.signal !== "string") {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "signal invalid" } };
    }
    const allowedKeys = ["v", "signal"];
    if (hasUnexpectedKeys(payload, allowedKeys)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "unexpected fields" } };
    }
    const allowedSignals = ["stressed", "exhausted", "ten_minutes", "more_energy"];
    if (!allowedSignals.includes(payload.signal)) {
      return { ok: false, error: { code: "INVALID_EVENT_PAYLOAD", message: "signal invalid" } };
    }
    return { ok: true, payload: { v: 1, signal: payload.signal } };
  }
  return { ok: true, payload: payload && typeof payload === "object" ? payload : {} };
}

function ensureEventPayload(type, payload, res) {
  const validation = validateEventPayload(type, payload);
  if (!validation.ok) {
    sendErrorCodeOnly(res, 400, "INVALID_EVENT_PAYLOAD");
    return null;
  }
  return validation.payload;
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
  if (!adminEmail || !envPolicy.allowStageContentPreview) return false;
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
  const allowLive = envPolicy.allowStageContentPreview && config.isDevLike && !config.isAlphaLike && !config.isProdLike;
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
  const snapshotIdOverride = options.snapshotId || null;
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
        snapshotId: snapshotIdOverride,
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
        snapshotId: snapshotIdOverride,
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

function mergeRegenPolicies(...policies) {
  const lockSelectionsByDate = {};
  let reason = null;
  policies.forEach((policy) => {
    if (!policy?.lockSelectionsByDate) return;
    Object.entries(policy.lockSelectionsByDate).forEach(([dateISO, locked]) => {
      if (locked) lockSelectionsByDate[dateISO] = true;
    });
    if (!reason && policy.reason) reason = policy.reason;
  });
  if (!Object.keys(lockSelectionsByDate).length) return null;
  return { lockSelectionsByDate, reason };
}

function buildStabilityPolicy(prevState, eventWithAt, planChanges7d) {
  if (!Number.isFinite(planChanges7d) || planChanges7d <= config.planChangeLimit7d) return null;
  const forced = eventWithAt.payload?.forced === true;
  if (forced) return null;
  const dates = getEventDatesForThrottle(prevState, eventWithAt);
  if (!dates.size) return null;
  const lockSelectionsByDate = {};
  dates.forEach((dateISO) => {
    if (dateISO) lockSelectionsByDate[dateISO] = true;
  });
  return { lockSelectionsByDate, reason: "stability_lock" };
}

function buildStabilityPreferences(state, todayISO) {
  const preferredIds = new Set();
  const days = state?.weekPlan?.days || [];
  if (!todayISO || !Array.isArray(days)) return { preferredIds, bonus: 0.15 };
  const fromISO = domain.addDaysISO(todayISO, -6);
  days.forEach((day) => {
    if (!day?.dateISO) return;
    if (day.dateISO < fromISO || day.dateISO > todayISO) return;
    if (day.workout?.id) preferredIds.add(day.workout.id);
    if (day.reset?.id) preferredIds.add(day.reset.id);
    if (day.nutrition?.id) preferredIds.add(day.nutrition.id);
  });
  return { preferredIds, bonus: 0.15 };
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

function extractConsentAcceptance(body = {}) {
  const accepted = new Set();
  const consents = Array.isArray(body?.consents)
    ? body.consents.filter((entry) => typeof entry === "string")
    : [];
  consents.forEach((entry) => accepted.add(entry.trim().toLowerCase()));
  const accept = body?.accept || body?.consent || {};
  const acceptTerms = accept.terms === true || body?.acceptTerms === true;
  const acceptPrivacy = accept.privacy === true || body?.acceptPrivacy === true;
  const acceptAlpha =
    accept.alphaProcessing === true ||
    accept.alpha_processing === true ||
    body?.acceptAlphaProcessing === true;
  if (acceptTerms) accepted.add("terms");
  if (acceptPrivacy) accepted.add("privacy");
  if (acceptAlpha) accepted.add("alpha_processing");
  return accepted;
}

async function handleConsentAccept(body, userId, res) {
  const accepted = extractConsentAcceptance(body);
  const missing = REQUIRED_CONSENTS.filter((key) => !accepted.has(key));
  if (missing.length) {
    sendError(
      res,
      badRequest("consent_required", "Missing required consent", "consents", {
        required: missing,
        expose: true,
      })
    );
    return false;
  }
  const requiredVersion = await getRequiredConsentVersion();
  await upsertUserConsents(userId, REQUIRED_CONSENTS, null, requiredVersion);
  sendJson(
    res,
    200,
    { ok: true, accepted: REQUIRED_CONSENTS, consentVersion: requiredVersion },
    userId
  );
  return true;
}

async function ensureRequiredConsents(userId, res) {
  if (!userId) return true;
  const requiredVersion = await getRequiredConsentVersion();
  const userVersion = await getUserConsentVersion(userId);
  if (userVersion < requiredVersion) {
    sendError(
      res,
      forbidden("consent_required_version", "Consent update required", null, {
        requiredVersion,
        userVersion,
        expose: true,
      })
    );
    return false;
  }
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

function consentStatusFromMap(consents) {
  const normalize = (entry) => {
    if (!entry) return false;
    if (typeof entry === "string") return true;
    if (typeof entry === "object") return Boolean(entry.acceptedAt || entry.accepted_at || entry.value);
    return false;
  };
  return {
    terms: normalize(consents?.terms),
    privacy: normalize(consents?.privacy),
    alpha_processing: normalize(consents?.alpha_processing),
  };
}

function profileCompleteness(profile) {
  if (!profile) return { isComplete: false, missingFields: ["timezone", "dayBoundaryHour"] };
  const requiredFields = ["timezone", "dayBoundaryHour"];
  const missingFields = requiredFields.filter((field) => profile[field] == null || profile[field] === "");
  return { isComplete: missingFields.length === 0, missingFields };
}

function isCanaryAllowed({ userId, userEmail }) {
  if (!canaryAllowlist.size) return true;
  const id = userId ? String(userId).toLowerCase() : "";
  const email = userEmail ? String(userEmail).toLowerCase() : "";
  if (id && canaryAllowlist.has(id)) return true;
  if (email && canaryAllowlist.has(email)) return true;
  return false;
}

async function buildBootstrapPayload({ userId, userProfile, userBaseline, userEmail, flags }) {
  const isAuthenticated = Boolean(userId);
  let consents = {};
  let userVersion = 0;
  if (isAuthenticated) {
    consents = await listUserConsents(userId);
    userVersion = await getUserConsentVersion(userId);
  }
  const accepted = consentStatusFromMap(consents);
  const userAcceptedKeys = Object.keys(accepted).filter((key) => accepted[key]);
  const requiredVersion = await getRequiredConsentVersion();
  const consentComplete = REQUIRED_CONSENTS.every((key) => accepted[key] === true);
  const consentVersionOk = userVersion >= requiredVersion;
  const baseline =
    userBaseline ||
    (userProfile
      ? {
          timezone: getUserTimezone(userProfile),
          dayBoundaryHour: getDayBoundaryHour(userProfile),
          constraints: userProfile?.constraints || null,
        }
      : null);
  const profileStatus = profileCompleteness(baseline);
  const tz = getUserTimezone(baseline);
  const dayBoundaryHour = getDayBoundaryHour(baseline);
  const dateISO = toDateISOWithBoundary(new Date(), tz, dayBoundaryHour) || domain.isoToday();
  const incidentMode = resolveIncidentMode(flags);
  const admin = userEmail ? isAdmin(userEmail) : false;
  const canaryAllowed = isCanaryAllowed({ userId, userEmail });
  let uiState = !isAuthenticated
    ? "login"
    : !consentComplete || !consentVersionOk
      ? "consent"
      : !profileStatus.isComplete
        ? "onboard"
        : "home";
  if (isAuthenticated && canaryAllowlist.size && !canaryAllowed) {
    uiState = "consent";
  }
  return {
    ok: true,
    now: { dateISO, tz, dayBoundaryHour },
    auth: {
      isAuthenticated,
      userId: isAuthenticated ? userId : undefined,
      isAdmin: admin,
    },
    consent: {
      required: REQUIRED_CONSENTS.slice(),
      requiredKeys: REQUIRED_CONSENTS.slice(),
      accepted,
      userAcceptedKeys,
      isComplete: consentComplete && consentVersionOk,
      requiredVersion,
      userVersion,
    },
    profile: {
      isComplete: profileStatus.isComplete,
      missingFields: profileStatus.missingFields,
    },
    baseline: baseline
      ? {
          timezone: tz,
          dayBoundaryHour,
          constraints: baseline.constraints || null,
        }
      : null,
    features: {
      incidentMode,
      railTodayAvailable: consentComplete && consentVersionOk && !incidentMode && isAuthenticated && canaryAllowed,
    },
    env: { mode: config.envMode },
    uiState,
  };
}

async function ensureHomeUiState({ userId, userProfile, userBaseline, userEmail, flags, pathname }, res) {
  let resolvedEmail = userEmail;
  if (canaryAllowlist.size && userId && !resolvedEmail) {
    const user = await getUserById(userId);
    resolvedEmail = user?.email || null;
  }
  const bootstrap = await buildBootstrapPayload({ userId, userProfile, userBaseline, userEmail: resolvedEmail, flags });
  const canaryAllowed = isCanaryAllowed({ userId, userEmail: resolvedEmail });
  const shouldWarn = pathname && pathname.startsWith("/v1/plan/");
  if (canaryAllowlist.size && !canaryAllowed) {
    if (shouldWarn) {
      logWarn({ event: "bootstrap_not_home", requestId: res?.livenewRequestId, userId, route: pathname, uiState: "canary" });
    }
    bumpMonitoringCounter("gating_violation");
    sendErrorCodeOnly(res, 403, "CANARY_GATED");
    return { ok: false, uiState: "consent" };
  }
  if (bootstrap.uiState !== "home") {
    if (shouldWarn) {
      logWarn({ event: "bootstrap_not_home", requestId: res?.livenewRequestId, userId, route: pathname, uiState: bootstrap.uiState });
    }
    bumpMonitoringCounter("gating_violation");
    sendErrorCodeOnly(res, 403, "BOOTSTRAP_NOT_HOME");
    return { ok: false, uiState: bootstrap.uiState };
  }
  return { ok: true, uiState: bootstrap.uiState };
}

function ensureTodayContract(contract, res) {
  try {
    return assertTodayContract(contract);
  } catch (err) {
    logError({ event: "today_contract_invalid", error: err?.message || String(err) });
    bumpMonitoringCounter("contract_invalid");
    sendErrorCodeOnly(res, 500, err.code || "TODAY_CONTRACT_INVALID");
    return null;
  }
}

function shouldUpdateDayState(prev, next) {
  if (!prev) return true;
  return !(
    prev.resetId === next.resetId &&
    prev.movementId === next.movementId &&
    prev.nutritionId === next.nutritionId &&
    prev.lastQuickSignal === next.lastQuickSignal &&
    prev.lastInputHash === next.lastInputHash
  );
}

async function loadContinuityMeta(userId, dateKey, timezone, dayBoundaryHour, now) {
  const recentRange = getDateRangeKeys({
    timezone,
    dayBoundaryHour,
    days: 7,
    endNow: now,
  });
  if (!recentRange?.fromKey) {
    return { continuity: computeContinuityMeta({ dateKey, recentEventsByDateKey: {} }), eventsToday: [] };
  }
  const recentEvents = await listDailyEvents(userId, recentRange.fromKey, recentRange.toKey);
  const recentByDate = {};
  recentEvents.forEach((event) => {
    if (!event?.dateISO) return;
    if (!recentByDate[event.dateISO]) recentByDate[event.dateISO] = [];
    recentByDate[event.dateISO].push(event);
  });
  return {
    continuity: computeContinuityMeta({ dateKey, recentEventsByDateKey: recentByDate }),
    eventsToday: (recentByDate[dateKey] || []).slice(),
  };
}

async function ensureWeekSeed(userId, dateKey, baseline, requestId) {
  const weekStartDateKey = weekStartMonday(dateKey);
  let weekState = await getWeekState(userId, weekStartDateKey);
  if (!weekState || weekState.libVersion !== LIB_VERSION) {
    const libraries = getLibrarySnapshot();
    const skeleton = buildWeekSkeleton({
      userId,
      startDateKey: weekStartDateKey,
      timezone: baseline.timezone,
      dayBoundaryHour: baseline.dayBoundaryHour,
      baseline,
      libVersion: LIB_VERSION,
      libraries,
    });
    await replaceWeekState(
      userId,
      weekStartDateKey,
      {
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        libVersion: LIB_VERSION,
      },
      skeleton
    );
    logInfo({
      event: "week_state_seeded",
      requestId,
      userId,
      weekStartDateKey,
      libVersion: LIB_VERSION,
      days: skeleton.length,
    });
    weekState = await getWeekState(userId, weekStartDateKey);
  }
  let weekSeed = await getWeekDaySeed(userId, dateKey);
  if (!weekSeed) {
    const libraries = getLibrarySnapshot();
    const skeleton = buildWeekSkeleton({
      userId,
      startDateKey: weekStartDateKey,
      timezone: baseline.timezone,
      dayBoundaryHour: baseline.dayBoundaryHour,
      baseline,
      libVersion: LIB_VERSION,
      libraries,
    });
    await replaceWeekState(
      userId,
      weekStartDateKey,
      {
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        libVersion: LIB_VERSION,
      },
      skeleton
    );
    logInfo({
      event: "week_state_repaired",
      requestId,
      userId,
      weekStartDateKey,
      dateKey,
    });
    weekSeed = await getWeekDaySeed(userId, dateKey);
  }
  return weekSeed;
}

async function resolvePriorProfile(userId, dateKey) {
  const prevDateKey = addDaysISO(dateKey, -1);
  const previous = await getDailyCheckIn(userId, prevDateKey);
  if (!previous?.checkIn) return null;
  const prevCheckIn = normalizeCheckInInput(previous.checkIn, prevDateKey);
  const scores = computeLoadCapacity({
    stress: prevCheckIn.stress,
    sleepQuality: prevCheckIn.sleepQuality,
    energy: prevCheckIn.energy,
    timeMin: prevCheckIn.timeAvailableMin,
  });
  return assignProfile({
    load: scores.load,
    capacity: scores.capacity,
    sleep: prevCheckIn.sleepQuality,
    energy: prevCheckIn.energy,
  });
}

async function runSmokeChecks({ userId, userEmail }) {
  const checks = [];
  let ok = true;
  try {
    await checkDbConnection();
    checks.push({ key: "healthz", ok: true });
  } catch {
    ok = false;
    checks.push({ key: "healthz", ok: false });
  }
  try {
    await checkReady();
    checks.push({ key: "readyz", ok: true });
  } catch {
    ok = false;
    checks.push({ key: "readyz", ok: false });
  }
  let bootstrap = null;
  try {
    const flags = await getFeatureFlags();
    let profile = null;
    let baseline = null;
    let resolvedEmail = userEmail;
    if (userId) {
      const cached = await loadUserState(userId);
      profile = cached?.state?.userProfile || null;
      baseline = await getUserBaseline(userId);
      if (!resolvedEmail) {
        const user = await getUserById(userId);
        resolvedEmail = user?.email || null;
      }
    }
    bootstrap = await buildBootstrapPayload({
      userId,
      userProfile: profile,
      userBaseline: baseline,
      userEmail: resolvedEmail,
      flags,
    });
    assertBootstrapContract(bootstrap);
    checks.push({ key: "bootstrap", ok: true });
  } catch {
    ok = false;
    checks.push({ key: "bootstrap", ok: false });
  }
  if (bootstrap?.auth?.isAuthenticated && bootstrap?.consent?.isComplete && !bootstrap?.features?.incidentMode) {
    checks.push({ key: "rail_today", ok: true });
  } else {
    checks.push({ key: "rail_today", ok: false, skipped: true });
  }
  return { ok: ok && checks.every((c) => c.ok || c.skipped), checks };
}

function renderSmokeHtml(report) {
  const rows = (report.checks || [])
    .map((check) => {
      const status = check.ok ? "ok" : check.skipped ? "skip" : "fail";
      const label = check.skipped ? "SKIPPED" : check.ok ? "OK" : "FAIL";
      return `<li class="${status}">${check.key}: ${label}</li>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiveNew Smoke</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; }
      .ok { color: #0a7a33; }
      .fail { color: #c62828; }
      .skip { color: #777; }
      ul { list-style: none; padding: 0; }
      li { margin: 6px 0; }
    </style>
  </head>
  <body>
    <h1>Smoke check</h1>
    <p>Status: ${report.ok ? "OK" : "FAIL"}</p>
    <ul>${rows}</ul>
  </body>
</html>`;
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

function sendErrorCodeOnly(res, status, code) {
  attachDbStats(res);
  const headers = { "Content-Type": "application/json", ...(res?.livenewExtraHeaders || {}) };
  if (res?.livenewApiVersion) headers["x-api-version"] = res.livenewApiVersion;
  res.writeHead(status, headers);
  res.errorCode = code;
  res.end(JSON.stringify({ error: code }));
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

function sendNotModified(res, etag) {
  attachDbStats(res);
  const headers = { ...(res?.livenewExtraHeaders || {}) };
  if (etag) headers["ETag"] = etag;
  if (res?.livenewApiVersion) headers["x-api-version"] = res.livenewApiVersion;
  res.writeHead(304, headers);
  res.end();
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildDeterminismKey(input) {
  return stableStringify(input);
}

function trackDeterminism(inputKey, inputHash, ctx) {
  const now = Date.now();
  for (const [key, value] of determinismCache.entries()) {
    if (now - value.at > DETERMINISM_TTL_MS) determinismCache.delete(key);
  }
  const existing = determinismCache.get(inputKey);
  if (existing && existing.hash !== inputHash) {
    logError({
      event: "nondeterminism_detected",
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      dateKey: ctx?.dateKey,
      prevHash: existing.hash,
      inputHash,
    });
    bumpMonitoringCounter("nondeterminism");
  }
  determinismCache.set(inputKey, { hash: inputHash, at: now });
}

function trackMissingIdempotency({ userId, route, requestHash, requestId }) {
  if (!userId || !route || !requestHash) return;
  const now = Date.now();
  for (const [key, value] of idempotencyWarnCache.entries()) {
    if (now - value.atMs > IDEMPOTENCY_WARN_WINDOW_MS) idempotencyWarnCache.delete(key);
  }
  const cacheKey = `${userId}|${route}|${requestHash}`;
  const existing = idempotencyWarnCache.get(cacheKey);
  if (existing && now - existing.atMs < IDEMPOTENCY_WARN_WINDOW_MS) {
    logWarn({ event: "idempotency_missing", requestId, userId, route, windowMs: IDEMPOTENCY_WARN_WINDOW_MS });
    bumpMonitoringCounter("idempotency_missing");
  }
  idempotencyWarnCache.set(cacheKey, { atMs: now });
}

function isWriteStorm({ userId, dateKey, route, requestId }) {
  const limit = Number(config.writeStormLimit || 0);
  const windowMs = Number(config.writeStormWindowMs || 0);
  if (!userId || !dateKey || !route) return false;
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return false;
  const now = Date.now();
  const cutoff = now - windowMs;
  const cacheKey = `${userId}|${dateKey}|${route}`;
  const entry = writeStormBuckets.get(cacheKey) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((ts) => ts >= cutoff);
  if (entry.timestamps.length >= limit) {
    entry.timestamps.push(now);
    writeStormBuckets.set(cacheKey, entry);
    logWarn({
      event: "write_storm",
      requestId,
      userId,
      route,
      dateKey,
      limit,
      windowMs,
      count: entry.timestamps.length,
    });
    bumpMonitoringCounter("write_storm");
    return true;
  }
  entry.timestamps.push(now);
  if (entry.timestamps.length) {
    writeStormBuckets.set(cacheKey, entry);
  } else {
    writeStormBuckets.delete(cacheKey);
  }
  return false;
}

function getIdempotencyKey(req) {
  const header = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value && String(value).trim()) return String(value).trim().slice(0, 128);
  const reqHeader = req.headers["x-request-id"];
  const reqValue = Array.isArray(reqHeader) ? reqHeader[0] : reqHeader;
  if (reqValue && String(reqValue).trim()) return String(reqValue).trim().slice(0, 128);
  return null;
}

function hashRequestPayload(payload) {
  const input = stableStringify(payload);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sendHtml(res, status, html) {
  const headers = { "Content-Type": "text/html; charset=utf-8", ...(res?.livenewExtraHeaders || {}) };
  res.writeHead(status, headers);
  res.end(html);
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

function diffList(prev = [], next = []) {
  const a = new Set(prev || []);
  const b = new Set(next || []);
  const added = [];
  const removed = [];
  b.forEach((value) => {
    if (!a.has(value)) added.push(value);
  });
  a.forEach((value) => {
    if (!b.has(value)) removed.push(value);
  });
  return { added, removed };
}

function extractAppliedRules(day) {
  const rules = day?.why?.expanded?.appliedRules;
  return Array.isArray(rules) ? rules : [];
}

function extractDrivers(day) {
  if (Array.isArray(day?.why?.driversTop2)) return day.why.driversTop2;
  const drivers = day?.why?.expanded?.drivers;
  return Array.isArray(drivers) ? drivers.slice(0, 2) : [];
}

function deltaNumber(prev, next) {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  return next - prev;
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

function panicDisclaimer() {
  return "If symptoms feel severe or unsafe, consider professional support.";
}

function buildPanicRailReset(reset) {
  if (!reset) return null;
  return {
    id: reset.id || null,
    title: reset.title || null,
    minutes: reset.minutes ?? null,
    steps: Array.isArray(reset.steps) ? reset.steps : [],
  };
}

function buildPanicDayContract(day, reset, dateISO) {
  const panicReset = buildPanicRailReset(reset);
  const minutes = panicReset?.minutes ?? 0;
  const disclaimer = panicDisclaimer();
  const baseDay = day || {};
  const baseWhy = baseDay.why || {};
  const safety = { level: "block", reasons: ["panic"], disclaimer };
  return {
    dateISO: dateISO || baseDay.dateISO || null,
    meta: {
      ...(baseDay.meta || {}),
      panic: true,
    },
    what: {
      workout: null,
      reset: panicReset,
      nutrition: null,
    },
    why: {
      profile: baseWhy.profile || null,
      focus: "downshift",
      driversTop2: [],
      shortRationale: "Reset-only plan while safety mode is active.",
      packMatch: baseWhy.packMatch || { packId: null, score: 0, topMatchedTags: [] },
      confidence: null,
      relevance: null,
      whatWouldChange: [],
      whyNot: ["Safety mode active."],
      reEntry: null,
      expanded: {
        drivers: [],
        appliedRules: [],
        anchors: null,
        safety,
        rationale: [],
      },
      statement: "Reset-only plan while safety mode is active.",
      rationale: [],
      meta: baseWhy.meta || null,
      safety,
      checkInPrompt: { shouldPrompt: false, reason: null },
    },
    howLong: {
      totalMinutes: minutes,
      timeAvailableMin: null,
    },
    details: {
      workoutSteps: [],
      resetSteps: panicReset?.steps || [],
      nutritionPriorities: [],
      anchors: null,
      citations: [],
    },
  };
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function isHashedAssetName(name) {
  return /[a-f0-9]{8,}/i.test(name);
}

function cacheControlForPath(filePath) {
  const baseName = path.basename(filePath);
  if (isHashedAssetName(baseName)) {
    return "public, max-age=31536000, immutable";
  }
  if (filePath.endsWith(".js")) {
    return "no-cache";
  }
  return null;
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

function outcomesCacheKey(userId, days, toKey) {
  return `${userId || "anon"}|${days}|${toKey || "unknown"}`;
}

function getOutcomesCache(userId, days, toKey) {
  const key = outcomesCacheKey(userId, days, toKey);
  const entry = outcomesCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    outcomesCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setOutcomesCache(userId, days, fromKey, toKey, payload, ttlMs = CACHE_TTLS.outcomes) {
  const key = outcomesCacheKey(userId, days, toKey);
  outcomesCache.set(key, {
    payload,
    fromKey,
    toKey,
    expiresAt: Date.now() + ttlMs,
  });
}

function invalidateOutcomesCache(userId, dateKey) {
  if (!userId || !dateKey) return;
  const prefix = `${userId}|`;
  for (const [key, entry] of outcomesCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    const fromKey = entry?.fromKey;
    const toKey = entry?.toKey;
    if (!fromKey || !toKey) {
      outcomesCache.delete(key);
      continue;
    }
    if (dateKey >= fromKey && dateKey <= toKey) {
      outcomesCache.delete(key);
    }
  }
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

function normalizeMetricDays(value, allowed = [7, 14, 30], fallback = 7) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (allowed.includes(parsed)) return parsed;
  return fallback;
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

async function computeStabilityChecklist() {
  const checks = [];

  let frontendAvailable = false;
  try {
    await fs.access(path.join(PUBLIC_DIR, "smoke-frontend.html"));
    frontendAvailable = true;
  } catch {
    frontendAvailable = false;
  }
  checks.push({
    key: "frontend_smoke_exists",
    pass: frontendAvailable,
    details: { path: "smoke-frontend.html" },
  });

  try {
    const smokeReport = await runSmokeChecks({ userId: null, userEmail: null });
    checks.push({
      key: "api_smoke_ok",
      pass: Boolean(smokeReport?.ok),
      details: { ok: smokeReport?.ok, checks: smokeReport?.checks || [] },
    });
  } catch (err) {
    checks.push({
      key: "api_smoke_ok",
      pass: false,
      details: { error: err?.message || "smoke failed" },
    });
  }

  const validator = await getLatestValidatorRun("engine_matrix");
  const validatorPass = validator ? validator.ok : true;
  checks.push({
    key: "validator_ok",
    pass: validatorPass,
    details: {
      latestRunId: validator?.id || null,
      latestAtISO: validator?.atISO || null,
      missing: !validator,
    },
  });

  const pass = checks.every((check) => check.pass);
  return { ok: true, pass, checks };
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
  const alpha = await alphaReadiness();
  const stability = await computeStabilityChecklist();

  const checklist = buildReleaseChecklist({
    alphaReadiness: {
      pass: alpha.pass,
      details: { missing: alpha.missing },
    },
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
    stability: {
      pass: stability.pass,
      details: { checks: stability.checks },
    },
  });

  return {
    checklist,
    alpha,
    validator,
    loadtestRun,
    loadtestEval,
    backups,
    requestSnapshot,
    errorRate,
    errorRateOk,
    stability,
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
    const isText =
      filePath.endsWith(".js") ||
      filePath.endsWith(".css") ||
      filePath.endsWith(".html") ||
      filePath.endsWith(".json");
    const raw = await fs.readFile(filePath, isText ? "utf8" : undefined);
    const body =
      replaceDevFlag && isText ? raw.replace("__IS_DEV__", isDevRoutesEnabled ? "true" : "false") : raw;
    const headers = { "Content-Type": contentTypeForPath(filePath) };
    const cacheControl = cacheControlForPath(filePath);
    if (cacheControl) headers["Cache-Control"] = cacheControl;
    res.writeHead(200, headers);
    res.end(body);
  } catch (err) {
    sendError(res, 404, "not_found", "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  return runWithQueryTracker(async () => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const routeKey = `${req.method} ${pathname}`;
  recordRouteHit(req.method, pathname);
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
    ["/smoke-frontend", "smoke-frontend.html"],
    ["/smoke-frontend.html", "smoke-frontend.html"],
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

  if (req.method === "GET" && pathname === "/favicon.ico") {
    await serveFile(res, path.join(PUBLIC_DIR, "favicon.ico"));
    return;
  }

  if (req.method === "GET" && pathname === "/favicon.png") {
    await serveFile(res, path.join(PUBLIC_DIR, "favicon.png"));
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/i18n/")) {
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
    let userId = null;
    let userEmail = null;
    let authSessionId = null;
    let usedLegacySession = false;
    let token = null;
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

    if (pathname === "/smoke" && req.method === "GET") {
      const report = await runSmokeChecks({ userId, userEmail });
      sendHtml(res, 200, renderSmokeHtml(report));
      return;
    }

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

    if (pathname === "/v1/smoke" && req.method === "GET") {
      const report = await runSmokeChecks({ userId, userEmail });
      sendJson(res, 200, report);
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
        const migrationFiles = (await fs.readdir(path.join(process.cwd(), "src", "db", "migrations"))).filter(
          (name) => name.endsWith(".sql") && !name.endsWith(".down.sql")
        );
        const expectedIds = migrationFiles
          .map((name) => name.replace(/\.sql$/, ""))
          .sort();
        const latestExpected = expectedIds[expectedIds.length - 1] || null;
        const latestApplied = migrations[migrations.length - 1]?.id || null;
        migrationsOk = migrations.length >= expectedIds.length && latestApplied === latestExpected;
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

    token = parseAuthToken(req);
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

    if ((pathname === "/v1/bootstrap" || pathname === "/v1/mobile/bootstrap") && req.method === "GET") {
      const flags = await getFeatureFlags();
      let profile = null;
      let baseline = null;
      let resolvedEmail = userEmail;
      if (userId) {
        const cached = await loadUserState(userId);
        profile = cached?.state?.userProfile || null;
        baseline = await getUserBaseline(userId);
        if (!resolvedEmail) {
          const user = await getUserById(userId);
          resolvedEmail = user?.email || null;
        }
      }
      const payload = await buildBootstrapPayload({
        userId,
        userProfile: profile,
        userBaseline: baseline,
        userEmail: resolvedEmail,
        flags,
      });
      assertBootstrapContract(payload);
      sendJson(res, 200, payload, userId || null);
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
      const contentPrefsBase = await loadContentPrefs(userId);

      while (attempts < 2) {
        const prevStats = currentState.selectionStats;
        const prevState = currentState;
        const todayISO = getTodayISOForProfile(currentState.userProfile);
        const planChanges7d = await countPlanChangeSummariesInRange(
          userId,
          domain.addDaysISO(todayISO, -6),
          todayISO
        );
        const stabilityPrefs = buildStabilityPreferences(currentState, todayISO);
        const contentPrefs = { ...contentPrefsBase, stability: stabilityPrefs, planChanges7d };
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
            snapshotId: snapshotCtx?.snapshotId || null,
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
        const stabilityPolicy = buildStabilityPolicy(currentState, eventWithAt, planChanges7d);
        const combinedPolicy = mergeRegenPolicies(regenPolicy, stabilityPolicy);
        if (combinedPolicy) {
          resEvent = dispatch(currentState, eventWithAt, { ...ctxBase, regenPolicy: combinedPolicy });
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

    if (
      pathname.startsWith("/v1/plan/") ||
      pathname === "/v1/rail/today" ||
      pathname === "/v1/mobile/today" ||
      pathname === "/v1/checkin" ||
      pathname === "/v1/quick" ||
      pathname === "/v1/reset/complete" ||
      pathname === "/v1/outcomes"
    ) {
      if (!userId) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const guards = resolveEngineGuards(requestFlags, incidentModeEnabled);
      if (guards.incidentMode) {
        sendError(res, 503, "incident_mode", "Incident mode active");
        return;
      }
      const ok = await ensureRequiredConsents(userId, res);
      if (!ok) return;
      const flags = await getFeatureFlags();
      const baseline = await getUserBaseline(userId);
      const home = await ensureHomeUiState({
        userId,
        userProfile: state.userProfile,
        userBaseline: baseline,
        userEmail,
        flags,
        pathname,
      }, res);
      if (!home.ok) return;
    }

    if (pathname === "/v1/profile" && req.method === "GET") {
      send(200, { ok: true, userProfile: state.userProfile || null });
      return;
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

    if (pathname === "/v1/consent/status" && req.method === "GET") {
      if (!userId) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const requiredVersion = await getRequiredConsentVersion();
      const userVersion = await getUserConsentVersion(userId);
      const consents = await listUserConsents(userId);
      const accepted = consentStatusFromMap(consents);
      send(200, {
        ok: true,
        accepted,
        required: REQUIRED_CONSENTS.slice(),
        requiredKeys: REQUIRED_CONSENTS.slice(),
        userAcceptedKeys: Object.keys(accepted).filter((key) => accepted[key]),
        requiredVersion,
        userVersion,
        isComplete:
          REQUIRED_CONSENTS.every((key) => accepted[key] === true) && userVersion >= requiredVersion,
      });
      return;
    }

    if (pathname === "/v1/consent/accept" && req.method === "POST") {
      if (!userId) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      await handleConsentAccept(body, userId, res);
      return;
    }

    if (pathname === "/v1/consents/accept" && req.method === "POST") {
      if (!userId) {
        sendError(res, 401, "auth_required", "Authorization required");
        return;
      }
      const body = await parseJson(req);
      await handleConsentAccept(body, userId, res);
      return;
    }

    if (pathname === "/v1/onboard/complete" && req.method === "POST") {
      const body = await parseJson(req);
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
      }
      const requiredVersion = await getRequiredConsentVersion();
      await upsertUserConsents(userId, REQUIRED_CONSENTS, null, requiredVersion);

      const baselineInput = normalizeBaselineInput(body?.baseline || body?.userProfile || body?.profile || {});
      const baselineValidation = validateBaselineInput(baselineInput);
      if (!baselineValidation.ok) {
        sendError(res, 400, baselineValidation.error.code, baselineValidation.error.message, baselineValidation.error.field);
        return;
      }
      const baseline = baselineValidation.value;
      await upsertUserBaseline(userId, baseline);

      const firstCheckInRaw =
        body?.firstCheckIn && typeof body.firstCheckIn === "object"
          ? body.firstCheckIn
          : body?.checkIn && typeof body.checkIn === "object"
            ? body.checkIn
            : {};
      let dateISO = firstCheckInRaw?.dateISO || body?.dateISO || getTodayISOForProfile(baseline);
      const dateValidation = validateDateParam(dateISO, "dateISO");
      if (!dateValidation.ok) {
        sendError(res, 400, dateValidation.error.code, dateValidation.error.message, dateValidation.error.field);
        return;
      }
      dateISO = dateValidation.value;
      const checkIn = normalizeCheckInInput(firstCheckInRaw, dateISO);
      await upsertDailyCheckIn(userId, dateISO, checkIn);
      const checkinEventPayload = ensureEventPayload(
        "checkin_submitted",
        {
          stress: checkIn.stress,
          sleep: checkIn.sleepQuality,
          energy: checkIn.energy,
          timeMin: checkIn.timeAvailableMin,
        },
        res
      );
      if (!checkinEventPayload) return;
      await insertDailyEventOnce({
        userId,
        dateISO,
        type: "checkin_submitted",
        atISO: new Date().toISOString(),
        props: checkinEventPayload,
      });
      invalidateOutcomesCache(userId, dateISO);
      const today = buildToday({
        userId,
        dateKey: dateISO,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: checkIn,
        dayState: null,
        eventsToday: [],
        panicMode: checkIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
      });
      const normalizedToday = ensureTodayContract(today, res);
      if (!normalizedToday) return;
      await upsertDayState(userId, dateISO, {
        resetId: normalizedToday.reset?.id || null,
        movementId: normalizedToday.movement?.id || null,
        nutritionId: normalizedToday.nutrition?.id || null,
        lastQuickSignal: null,
        lastInputHash: normalizedToday.meta?.inputHash || null,
      });

      const flags = await getFeatureFlags();
      const bootstrap = await buildBootstrapPayload({
        userId,
        userBaseline: baseline,
        userEmail,
        flags,
      });
      const payload = {
        ok: true,
        bootstrap,
        today: normalizedToday,
      };
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
      const snapshotCtx = await getSnapshotContext();
      const paramsState = snapshotCtx.paramsState || (await getParamsForUser());
      const library = snapshotCtx.library || domain.defaultLibrary;
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "force_refresh_invariant",
        requestId,
        { paramsState, library, snapshotId: snapshotCtx.snapshotId || null }
      );
      state = ensured.state;
      send(200, { ok: true, day: ensured.day });
      return;
    }

    if ((pathname === "/v1/rail/today" || pathname === "/v1/mobile/today") && req.method === "GET") {
      const ifNoneMatch = req.headers["if-none-match"];
      parityCounters.recordTodayRequest(Boolean(ifNoneMatch));
      const baseline = await getUserBaseline(userId);
      if (!baseline) {
        sendError(res, 400, "baseline_required", "Baseline required before loading today");
        return;
      }
      const now = new Date();
      const dateKey = getDateKey({
        now,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
      });
      if (!dateKey) {
        sendError(res, 400, "date_invalid", "Unable to resolve date key");
        return;
      }
      // Week key is Monday-start based on the local dateKey (timezone + boundary already applied).
      const weekSeed = await ensureWeekSeed(userId, dateKey, baseline, requestId);
      const railOpenedAtISO = now.toISOString();
      const railPayload = ensureEventPayload("rail_opened", { v: 1 }, res);
      if (!railPayload) return;
      try {
        const inserted = await insertDailyEventOnce({
          userId,
          dateISO: dateKey,
          type: "rail_opened",
          atISO: railOpenedAtISO,
          props: railPayload,
        });
        logInfo({
          event: "daily_event_insert",
          requestId,
          userId,
          dateKey,
          type: "rail_opened",
          inserted: inserted?.inserted === true,
        });
        if (inserted?.inserted === true) {
          invalidateOutcomesCache(userId, dateKey);
        }
      } catch (err) {
        logError({ event: "daily_event_rail_open_failed", error: err?.message || String(err) });
      }
      try {
        await trackEvent(userId, "rail_opened", { dateISO: dateKey }, railOpenedAtISO, dateKey);
        await upsertAnalyticsUserDayTimes({
          dateISO: dateKey,
          userId,
          firstRailOpenedAt: railOpenedAtISO,
        });
      } catch (err) {
        logError({ event: "analytics_rail_open_failed", error: err?.message || String(err) });
      }
      const stored = await getDailyCheckIn(userId, dateKey);
      const checkIn = normalizeCheckInInput(stored?.checkIn || {}, dateKey);
      const dayState = await getDayState(userId, dateKey);
      const { continuity, eventsToday } = await loadContinuityMeta(
        userId,
        dateKey,
        baseline.timezone,
        baseline.dayBoundaryHour,
        now
      );
      const priorProfile = await resolvePriorProfile(userId, dateKey);
      const today = buildToday({
        userId,
        dateKey,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: checkIn,
        dayState,
        weekSeed,
        eventsToday,
        panicMode: checkIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
        continuity,
        priorProfile,
      });
      const normalizedToday = ensureTodayContract(today, res);
      if (!normalizedToday) return;
      const etag = normalizedToday.meta?.inputHash || null;
      if (etag) {
        res.livenewExtraHeaders = { ...(res.livenewExtraHeaders || {}), ETag: etag };
        if (ifNoneMatch && String(ifNoneMatch) === String(etag)) {
          etagNotModifiedCount += 1;
          logDebug({
            event: "etag_not_modified",
            requestId,
            userId,
            route: "/v1/rail/today",
            count: etagNotModifiedCount,
          });
          parityCounters.recordTodayNotModified();
          sendNotModified(res, etag);
          return;
        }
      }
      const nextState = {
        resetId: normalizedToday.reset?.id || null,
        movementId: normalizedToday.movement?.id || null,
        nutritionId: normalizedToday.nutrition?.id || null,
        lastQuickSignal: dayState?.lastQuickSignal || null,
        lastInputHash: normalizedToday.meta?.inputHash || null,
      };
      const selectionChanged = shouldUpdateDayState(dayState, nextState);
      if (selectionChanged) {
        await upsertDayState(userId, dateKey, nextState);
      }
      logInfo({
        event: "today_contract",
        requestId,
        userId,
        dateKey,
        inputHash: normalizedToday.meta?.inputHash,
      });
      trackDeterminism(
        buildDeterminismKey({
          userId,
          dateKey,
          checkIn,
          dayState: nextState,
          weekSeed,
          libVersion: LIB_VERSION,
          priorProfile,
        }),
        normalizedToday.meta?.inputHash,
        { requestId, userId, dateKey }
      );
      logInfo({
        event: "today_selection",
        requestId,
        userId,
        dateKey,
        inputHash: normalizedToday.meta?.inputHash,
        changed: selectionChanged,
        resetId: nextState.resetId,
        movementId: nextState.movementId,
        nutritionId: nextState.nutritionId,
      });
      send(200, normalizedToday);
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
      const snapshotCtx = await getSnapshotContext();
      const paramsState = snapshotCtx.paramsState || (await getParamsForUser());
      const library = snapshotCtx.library || domain.defaultLibrary;
      const ensured = await ensureValidDayContract(
        userId,
        state,
        dateISO,
        "plan_day_invariant",
        requestId,
        { paramsState, library, snapshotId: snapshotCtx.snapshotId || null }
      );
      state = ensured.state;
      const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
      const checkIn = latestCheckInForDate(state.checkIns, dateISO);
      const panicActive = Boolean(checkIn?.panic || dayPlan?.safety?.reasons?.includes?.("panic"));
      let day = ensured.day;
      let payload = { ok: true, day };
      if (panicActive) {
        const prefs = await loadContentPrefs(userId);
        const panicReset = pickRailReset({ dayPlan, checkIn, library, preferences: prefs });
        day = buildPanicDayContract(ensured.day, panicReset, dateISO);
        payload = { ok: true, day, panic: { active: true, disclaimer: panicDisclaimer() } };
      }
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
      if (config.writesDisabled) {
        bumpMonitoringCounter("writes_disabled");
        sendErrorCodeOnly(res, 503, "WRITES_DISABLED");
        return;
      }
      if (config.disableCheckinWrites) {
        bumpMonitoringCounter("checkin_disabled");
        sendErrorCodeOnly(res, 503, "CHECKIN_DISABLED");
        return;
      }
      const guards = getEngineGuardsSnapshot();
      if (guards.checkinsEnabled === false) {
        sendError(res, 403, "feature_disabled", "Check-ins are disabled");
        return;
      }
      const now = new Date();
      const body = await parseJson(req);
      const baseline = await getUserBaseline(userId);
      if (!baseline) {
        sendError(res, 400, "baseline_required", "Baseline required before check-in");
        return;
      }
      let dateKey =
        body?.dateKey ||
        body?.dateISO ||
        body?.checkIn?.dateISO ||
        getDateKey({ now, timezone: baseline.timezone, dayBoundaryHour: baseline.dayBoundaryHour });
      const dateValidation = validateDateParam(dateKey, "dateISO");
      if (!dateValidation.ok) {
        sendError(res, 400, dateValidation.error.code, dateValidation.error.message, dateValidation.error.field);
        return;
      }
      dateKey = dateValidation.value;
      const checkInRaw = body?.checkIn && typeof body.checkIn === "object" ? body.checkIn : body;
      const checkinValidation = validateCheckInPayload(checkInRaw);
      if (!checkinValidation.ok) {
        sendErrorCodeOnly(res, 400, "INVALID_CHECKIN");
        return;
      }
      const checkIn = normalizeCheckInInput(checkInRaw, dateKey);
      const idempotencyKey = getIdempotencyKey(req);
      parityCounters.recordCheckin(Boolean(idempotencyKey));
      const idempotencyRoute = res.livenewRouteKey;
      let idempotencyHash = null;
      if (!idempotencyKey) {
        const requestHash = hashRequestPayload({ dateKey, checkIn });
        trackMissingIdempotency({ userId, route: idempotencyRoute, requestHash, requestId });
      }
      if (idempotencyKey) {
        idempotencyHash = hashRequestPayload({ dateKey, checkIn });
        const existing = await getIdempotencyRecord(userId, idempotencyRoute, idempotencyKey);
        if (existing && existing.requestHash !== idempotencyHash) {
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_CONFLICT");
          return;
        }
        if (existing?.response) {
          send(200, existing.response);
          return;
        }
        if (existing) {
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_IN_PROGRESS");
          return;
        }
      }
      if (isWriteStorm({ userId, dateKey, route: idempotencyRoute, requestId })) {
        sendErrorCodeOnly(res, 429, "WRITE_STORM");
        return;
      }
      if (idempotencyKey) {
        const inserted = await insertIdempotencyRecord(userId, idempotencyRoute, idempotencyKey, idempotencyHash);
        if (!inserted) {
          const existing = await getIdempotencyRecord(userId, idempotencyRoute, idempotencyKey);
          if (existing && existing.requestHash !== idempotencyHash) {
            sendErrorCodeOnly(res, 409, "IDEMPOTENCY_CONFLICT");
            return;
          }
          if (existing?.response) {
            send(200, existing.response);
            return;
          }
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_IN_PROGRESS");
          return;
        }
        logInfo({ event: "idempotency_inserted", requestId, userId, route: idempotencyRoute });
      }
      await upsertDailyCheckIn(userId, dateKey, checkIn);
      const checkinEventPayload = ensureEventPayload(
        "checkin_submitted",
        {
          stress: checkIn.stress,
          sleep: checkIn.sleepQuality,
          energy: checkIn.energy,
          timeMin: checkIn.timeAvailableMin,
        },
        res
      );
      if (!checkinEventPayload) return;
      await insertDailyEvent({
        userId,
        dateISO: dateKey,
        type: "checkin_submitted",
        atISO: now.toISOString(),
        props: checkinEventPayload,
      });
      invalidateOutcomesCache(userId, dateKey);
      const dayState = await getDayState(userId, dateKey);
      const weekSeed = await ensureWeekSeed(userId, dateKey, baseline, requestId);
      const { continuity, eventsToday } = await loadContinuityMeta(
        userId,
        dateKey,
        baseline.timezone,
        baseline.dayBoundaryHour,
        now
      );
      const priorProfile = await resolvePriorProfile(userId, dateKey);
      const today = buildToday({
        userId,
        dateKey,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: checkIn,
        dayState,
        weekSeed,
        eventsToday,
        panicMode: checkIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
        continuity,
        priorProfile,
      });
      const normalizedToday = ensureTodayContract(today, res);
      if (!normalizedToday) return;
      const nextState = {
        resetId: normalizedToday.reset?.id || null,
        movementId: normalizedToday.movement?.id || null,
        nutritionId: normalizedToday.nutrition?.id || null,
        lastQuickSignal: dayState?.lastQuickSignal || null,
        lastInputHash: normalizedToday.meta?.inputHash || null,
      };
      const selectionChanged = shouldUpdateDayState(dayState, nextState);
      if (selectionChanged) {
        await upsertDayState(userId, dateKey, nextState);
      }
      logInfo({ event: "checkin_contract", requestId, userId, dateKey, inputHash: normalizedToday.meta?.inputHash });
      if (idempotencyKey && idempotencyHash) {
        const responsePayload = unwrapTodayEnvelope(normalizedToday);
        const saved = await setIdempotencyResponse(
          userId,
          idempotencyRoute,
          idempotencyKey,
          idempotencyHash,
          responsePayload
        );
        if (!saved) {
          logError({ event: "idempotency_response_failed", requestId, userId, route: idempotencyRoute });
        }
      }
      trackDeterminism(
        buildDeterminismKey({
          userId,
          dateKey,
          checkIn,
          dayState,
          weekSeed,
          libVersion: LIB_VERSION,
          priorProfile,
        }),
        normalizedToday.meta?.inputHash,
        { requestId, userId, dateKey }
      );
      logInfo({
        event: "checkin_selection",
        requestId,
        userId,
        dateKey,
        inputHash: normalizedToday.meta?.inputHash,
        changed: selectionChanged,
        resetId: nextState.resetId,
        movementId: nextState.movementId,
        nutritionId: nextState.nutritionId,
      });
      send(200, normalizedToday);
      return;
    }

    if (pathname === "/v1/quick" && req.method === "POST") {
      if (config.writesDisabled) {
        bumpMonitoringCounter("writes_disabled");
        sendErrorCodeOnly(res, 503, "WRITES_DISABLED");
        return;
      }
      if (config.disableQuickWrites) {
        bumpMonitoringCounter("quick_disabled");
        sendErrorCodeOnly(res, 503, "QUICK_DISABLED");
        return;
      }
      const now = new Date();
      const body = await parseJson(req);
      const signal = typeof body?.signal === "string" ? body.signal : null;
      const allowed = ["stressed", "exhausted", "ten_minutes", "more_energy"];
      if (!signal || !allowed.includes(signal)) {
        sendErrorCodeOnly(res, 400, "INVALID_SIGNAL");
        return;
      }
      const baseline = await getUserBaseline(userId);
      if (!baseline) {
        sendError(res, 400, "baseline_required", "Baseline required before quick adjust");
        return;
      }
      let dateKey =
        body?.dateKey ||
        body?.dateISO ||
        getDateKey({ now, timezone: baseline.timezone, dayBoundaryHour: baseline.dayBoundaryHour });
      const dateValidation = validateDateParam(dateKey, "dateISO");
      if (!dateValidation.ok) {
        sendError(res, 400, dateValidation.error.code, dateValidation.error.message, dateValidation.error.field);
        return;
      }
      dateKey = dateValidation.value;
      const idempotencyKey = getIdempotencyKey(req);
      parityCounters.recordQuick(Boolean(idempotencyKey));
      const idempotencyRoute = res.livenewRouteKey;
      let idempotencyHash = null;
      if (!idempotencyKey) {
        const requestHash = hashRequestPayload({ dateKey, signal });
        trackMissingIdempotency({ userId, route: idempotencyRoute, requestHash, requestId });
      }
      if (idempotencyKey) {
        idempotencyHash = hashRequestPayload({ dateKey, signal });
        const existing = await getIdempotencyRecord(userId, idempotencyRoute, idempotencyKey);
        if (existing && existing.requestHash !== idempotencyHash) {
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_CONFLICT");
          return;
        }
        if (existing?.response) {
          send(200, existing.response);
          return;
        }
        if (existing) {
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_IN_PROGRESS");
          return;
        }
      }
      if (isWriteStorm({ userId, dateKey, route: idempotencyRoute, requestId })) {
        sendErrorCodeOnly(res, 429, "WRITE_STORM");
        return;
      }
      if (idempotencyKey) {
        const inserted = await insertIdempotencyRecord(userId, idempotencyRoute, idempotencyKey, idempotencyHash);
        if (!inserted) {
          const existing = await getIdempotencyRecord(userId, idempotencyRoute, idempotencyKey);
          if (existing && existing.requestHash !== idempotencyHash) {
            sendErrorCodeOnly(res, 409, "IDEMPOTENCY_CONFLICT");
            return;
          }
          if (existing?.response) {
            send(200, existing.response);
            return;
          }
          sendErrorCodeOnly(res, 409, "IDEMPOTENCY_IN_PROGRESS");
          return;
        }
        logInfo({ event: "idempotency_inserted", requestId, userId, route: idempotencyRoute });
      }
      const existing = await getDailyCheckIn(userId, dateKey);
      const baseCheckIn = normalizeCheckInInput(existing?.checkIn || {}, dateKey);
      const dayState = await getDayState(userId, dateKey);
      const weekSeed = await ensureWeekSeed(userId, dateKey, baseline, requestId);
      const { continuity, eventsToday } = await loadContinuityMeta(
        userId,
        dateKey,
        baseline.timezone,
        baseline.dayBoundaryHour,
        now
      );
      const priorProfile = await resolvePriorProfile(userId, dateKey);
      const currentToday = buildToday({
        userId,
        dateKey,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: baseCheckIn,
        dayState,
        weekSeed,
        eventsToday,
        panicMode: baseCheckIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
        continuity,
        priorProfile,
      });
      const normalizedCurrent = ensureTodayContract(currentToday, res);
      if (!normalizedCurrent) return;
      const libraries = getLibrarySnapshot();
      const selection = {
        resetId: normalizedCurrent.reset?.id || null,
        movementId: normalizedCurrent.movement?.id || null,
        nutritionId: normalizedCurrent.nutrition?.id || null,
      };
      const updatedSelection =
        dayState?.lastQuickSignal === signal
          ? selection
          : applyQuickSignal({
              signal,
              todaySelection: selection,
              scored: normalizedCurrent.scores,
              profile: normalizedCurrent.profile,
              constraints: baseline.constraints || {},
              libraries,
            });
      const quickPayload = ensureEventPayload("quick_adjusted", { signal }, res);
      if (!quickPayload) return;
      await insertDailyEvent({
        userId,
        dateISO: dateKey,
        type: "quick_adjusted",
        atISO: now.toISOString(),
        props: quickPayload,
      });
      const nextDayState = {
        resetId: updatedSelection.resetId || null,
        movementId: updatedSelection.movementId || null,
        nutritionId: updatedSelection.nutritionId || null,
        lastQuickSignal: signal,
        lastInputHash: dayState?.lastInputHash || null,
      };
      const { continuity: continuityAfter, eventsToday: eventsAfter } = await loadContinuityMeta(
        userId,
        dateKey,
        baseline.timezone,
        baseline.dayBoundaryHour,
        now
      );
      const refreshed = buildToday({
        userId,
        dateKey,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: baseCheckIn,
        dayState: { ...nextDayState },
        weekSeed,
        eventsToday: eventsAfter,
        panicMode: baseCheckIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
        continuity: continuityAfter,
        priorProfile,
      });
      const normalizedRefreshed = ensureTodayContract(refreshed, res);
      if (!normalizedRefreshed) return;
      const finalState = {
        ...nextDayState,
        lastInputHash: normalizedRefreshed.meta?.inputHash || null,
      };
      const selectionChanged = shouldUpdateDayState(dayState, finalState);
      if (selectionChanged) {
        await upsertDayState(userId, dateKey, finalState);
      }
      logInfo({ event: "quick_contract", requestId, userId, dateKey, inputHash: normalizedRefreshed.meta?.inputHash });
      if (idempotencyKey && idempotencyHash) {
        const responsePayload = unwrapTodayEnvelope(normalizedRefreshed);
        const saved = await setIdempotencyResponse(
          userId,
          idempotencyRoute,
          idempotencyKey,
          idempotencyHash,
          responsePayload
        );
        if (!saved) {
          logError({ event: "idempotency_response_failed", requestId, userId, route: idempotencyRoute });
        }
      }
      trackDeterminism(
        buildDeterminismKey({
          userId,
          dateKey,
          checkIn: baseCheckIn,
          dayState: finalState,
          weekSeed,
          libVersion: LIB_VERSION,
          priorProfile,
        }),
        normalizedRefreshed.meta?.inputHash,
        { requestId, userId, dateKey }
      );
      logInfo({
        event: "quick_selection",
        requestId,
        userId,
        dateKey,
        inputHash: normalizedRefreshed.meta?.inputHash,
        changed: selectionChanged,
        resetId: finalState.resetId,
        movementId: finalState.movementId,
        nutritionId: finalState.nutritionId,
        signal,
      });
      send(200, normalizedRefreshed);
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

    const prefsDeleteMatch = pathname.match(/^\/v1\/content\/prefs\/([^/]+)$/);
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

    if (pathname === "/v1/reset/complete" && req.method === "POST") {
      if (config.writesDisabled) {
        bumpMonitoringCounter("writes_disabled");
        sendErrorCodeOnly(res, 503, "WRITES_DISABLED");
        return;
      }
      if (config.disableResetWrites) {
        bumpMonitoringCounter("reset_disabled");
        sendErrorCodeOnly(res, 503, "RESET_DISABLED");
        return;
      }
      const now = new Date();
      const body = await parseJson(req);
      const baseline = await getUserBaseline(userId);
      if (!baseline) {
        sendError(res, 400, "baseline_required", "Baseline required before reset completion");
        return;
      }
      const resetId = typeof body?.resetId === "string" ? body.resetId : null;
      if (!resetId) {
        sendError(res, 400, "reset_id_required", "resetId is required", "resetId");
        return;
      }
      let dateKey =
        body?.dateKey ||
        body?.dateISO ||
        getDateKey({ now, timezone: baseline.timezone, dayBoundaryHour: baseline.dayBoundaryHour });
      const dateValidation = validateDateParam(dateKey, "dateISO");
      if (!dateValidation.ok) {
        sendError(res, 400, dateValidation.error.code, dateValidation.error.message, dateValidation.error.field);
        return;
      }
      dateKey = dateValidation.value;
      if (isWriteStorm({ userId, dateKey, route: res.livenewRouteKey, requestId })) {
        sendErrorCodeOnly(res, 429, "WRITE_STORM");
        return;
      }
      const completedAtISO = now.toISOString();
      const resetPayload = ensureEventPayload("reset_completed", { resetId }, res);
      if (!resetPayload) return;
      const inserted = await insertDailyEventOnce({
        userId,
        dateISO: dateKey,
        type: "reset_completed",
        atISO: completedAtISO,
        props: resetPayload,
      });
      logInfo({
        event: "daily_event_insert",
        requestId,
        userId,
        dateKey,
        type: "reset_completed",
        inserted: inserted?.inserted === true,
      });
      if (inserted?.inserted === true) {
        invalidateOutcomesCache(userId, dateKey);
      }
      const stored = await getDailyCheckIn(userId, dateKey);
      const checkIn = normalizeCheckInInput(stored?.checkIn || {}, dateKey);
      const dayState = await getDayState(userId, dateKey);
      const weekSeed = await ensureWeekSeed(userId, dateKey, baseline, requestId);
      const { continuity, eventsToday } = await loadContinuityMeta(
        userId,
        dateKey,
        baseline.timezone,
        baseline.dayBoundaryHour,
        now
      );
      const priorProfile = await resolvePriorProfile(userId, dateKey);
      const today = buildToday({
        userId,
        dateKey,
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        baseline,
        latestCheckin: checkIn,
        dayState,
        weekSeed,
        eventsToday,
        panicMode: checkIn?.safety?.panic === true,
        libVersion: LIB_VERSION,
        continuity,
        priorProfile,
      });
      const normalizedToday = ensureTodayContract(today, res);
      if (!normalizedToday) return;
      const nextState = {
        resetId: normalizedToday.reset?.id || null,
        movementId: normalizedToday.movement?.id || null,
        nutritionId: normalizedToday.nutrition?.id || null,
        lastQuickSignal: dayState?.lastQuickSignal || null,
        lastInputHash: normalizedToday.meta?.inputHash || null,
      };
      const selectionChanged = shouldUpdateDayState(dayState, nextState);
      if (selectionChanged) {
        await upsertDayState(userId, dateKey, nextState);
      }
      logInfo({ event: "reset_complete", requestId, userId, dateKey, inputHash: normalizedToday.meta?.inputHash });
      trackDeterminism(
        buildDeterminismKey({
          userId,
          dateKey,
          checkIn,
          dayState: nextState,
          weekSeed,
          libVersion: LIB_VERSION,
          priorProfile,
        }),
        normalizedToday.meta?.inputHash,
        { requestId, userId, dateKey }
      );
      logInfo({
        event: "reset_selection",
        requestId,
        userId,
        dateKey,
        inputHash: normalizedToday.meta?.inputHash,
        changed: selectionChanged,
        resetId: nextState.resetId,
        movementId: nextState.movementId,
        nutritionId: nextState.nutritionId,
      });
      send(200, normalizedToday);
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
      const prevCompleted = Boolean(state.partCompletionByDate?.[dateISO]?.[part]);
      await dispatchForUser({ type: "TOGGLE_PART_COMPLETION", payload: { dateISO, part } });
      const nextCompleted = Boolean(state.partCompletionByDate?.[dateISO]?.[part]);
      if (part === "reset" && nextCompleted && !prevCompleted) {
        const resetId = state.weekPlan?.days?.find((day) => day.dateISO === dateISO)?.reset?.id || null;
        const atISO = new Date().toISOString();
        try {
          await trackEvent(userId, "reset_completed", { resetId }, atISO, dateISO);
          await upsertAnalyticsUserDayTimes({
            dateISO,
            userId,
            firstResetCompletedAt: atISO,
          });
        } catch (err) {
          logError({ event: "analytics_reset_complete_failed", error: err?.message || String(err) });
        }
      }
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
      const daysParam = url.searchParams.get("days") || "7";
      const daysNum = Number(daysParam);
      const allowed = [7, 14, 30];
      if (!allowed.includes(daysNum)) {
        sendError(res, 400, "days_invalid", "days must be 7, 14, or 30", "days");
        return;
      }
      const baseline = await getUserBaseline(userId);
      if (!baseline) {
        sendError(res, 400, "baseline_required", "Baseline required before outcomes");
        return;
      }
      const now = new Date();
      const range = getDateRangeKeys({
        timezone: baseline.timezone,
        dayBoundaryHour: baseline.dayBoundaryHour,
        days: daysNum,
        endNow: now,
      });
      if (!range.toKey) {
        sendError(res, 400, "date_invalid", "Unable to resolve date range");
        return;
      }
      const cached = getOutcomesCache(userId, daysNum, range.toKey);
      if (cached) {
        send(200, cached);
        return;
      }
      const events = await listDailyEvents(userId, range.fromKey, range.toKey);

      const railDays = new Set();
      const resetDays = new Set();
      const checkinDays = new Set();
      events.forEach((event) => {
        if (event.type === "rail_opened") railDays.add(event.dateISO);
        if (event.type === "reset_completed") resetDays.add(event.dateISO);
        if (event.type === "checkin_submitted") checkinDays.add(event.dateISO);
      });

      const payload = {
        ok: true,
        range: { days: daysNum, fromISO: range.fromKey, toISO: range.toKey },
        metrics: {
          railOpenedDays: railDays.size,
          resetCompletedDays: resetDays.size,
          checkinSubmittedDays: checkinDays.size,
          resetCompletionRate: railDays.size ? resetDays.size / railDays.size : 0,
        },
      };
      setOutcomesCache(userId, daysNum, range.fromKey, range.toKey, payload, CACHE_TTLS.outcomes);
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
      const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
      if (kind !== "engine_matrix") {
        sendError(res, 400, "validator_kind_invalid", "kind must be engine_matrix", "kind");
        return;
      }
      const report = await runEngineValidatorTask({ snapshotId: snapshotId || null });
      await auditAdmin("validator.run", report.runId, { kind, ok: report.ok, failed: report.totals?.failed || 0, snapshotId: snapshotId || null });
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
      clearSnapshotCache(snapshotId);
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
      const body = await parseJson(req);
      const includeUserNotes = body?.includeUserNotes === true;
      const { checklist } = await computeReleaseChecklistState();
      if (!checklist.pass) {
        sendError(res, 409, "release_blocked", "Release blocked by checklist", null, {
          checks: checklist.checks,
          expose: true,
        });
        return;
      }
      const latestValidator = await getLatestValidatorRun("engine_matrix", snapshotId);
      const validatorFresh =
        latestValidator?.atISO && Date.now() - Date.parse(latestValidator.atISO) <= 6 * 60 * 60 * 1000;
      let validatorOk = Boolean(latestValidator?.ok && validatorFresh);
      let validatorReport = latestValidator?.report || null;
      if (!validatorOk) {
        const report = await runEngineValidatorTask({ snapshotId });
        validatorOk = Boolean(report.ok);
        validatorReport = report;
      }
      if (!validatorOk) {
        sendError(res, 409, "release_blocked", "Release blocked by validator", null, {
          expose: true,
          validator: { snapshotId, ok: false, report: validatorReport },
        });
        return;
      }
      const prevReleased = await getLatestReleasedSnapshot();
      const updated = await updateContentSnapshotStatus({
        snapshotId,
        status: "released",
        releasedAt: new Date().toISOString(),
        rolledBackAt: null,
      });
      await setDefaultSnapshotId(snapshotId);
      clearSnapshotCache(snapshotId);
      let diff = null;
      if (prevReleased && prevReleased.id !== snapshotId) {
        const itemsA = await listContentSnapshotItems(prevReleased.id);
        const itemsB = await listContentSnapshotItems(snapshotId);
        const packsA = await listContentSnapshotPacks(prevReleased.id);
        const packsB = await listContentSnapshotPacks(snapshotId);
        const paramsA = await listContentSnapshotParams(prevReleased.id);
        const paramsB = await listContentSnapshotParams(snapshotId);
        diff = diffSnapshots({ itemsA, itemsB, packsA, packsB, paramsA, paramsB });
      }
      const releaseNotes = JSON.stringify({ note: snapshot.note || "", diff }, null, 2);
      await insertChangelogEntry({
        version: snapshotId,
        title: `Snapshot ${snapshotId} released`,
        notes: releaseNotes,
        audience: "admin",
      });
      if (includeUserNotes) {
        await insertChangelogEntry({
          version: snapshotId,
          title: snapshot.note || `Snapshot ${snapshotId}`,
          notes: snapshot.note || "Snapshot update",
          audience: "user",
        });
      }
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
      clearSnapshotCache(snapshotId);
      clearSnapshotCache(targetSnapshotId);
      const runningExperiments = await listExperiments("running");
      const nowISO = new Date().toISOString();
      for (const exp of runningExperiments) {
        if (exp.snapshotId && exp.snapshotId === snapshotId) {
          await updateExperiment(exp.id, { status: "stopped", stoppedAt: nowISO });
          await insertAdminAudit({
            adminUserId: userId,
            action: "experiment.auto_stop",
            target: exp.id,
            props: { reason: "snapshot_rollback", snapshotId },
          });
        }
      }
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

    if (pathname === "/v1/admin/alpha/readiness" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const readiness = await alphaReadiness();
      send(200, { ok: true, readiness });
      return;
    }

    if (pathname === "/v1/admin/ops/daily" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const dayISO = domain.isoToday();
      const validator = await getLatestValidatorRun("engine_matrix");
      const errors = snapshotErrorCounters(10);
      const latencyByRoute = Array.from(LATENCY_ROUTES).reduce((acc, routeKey) => {
        acc[routeKey] = latencyStats(routeKey);
        return acc;
      }, {});
      const latencyThresholds = config.maxP95MsByRoute || {};
      let latencyOk = true;
      const p95ByRoute = {};
      Object.entries(latencyByRoute).forEach(([routeKey, stats]) => {
        const routePath = routeKey.split(" ").slice(1).join(" ");
        const threshold = latencyThresholds[routeKey] ?? latencyThresholds[routePath] ?? null;
        p95ByRoute[routeKey] = stats.p95;
        if (threshold != null && (stats.p95 == null || stats.p95 > threshold)) latencyOk = false;
      });
      const stabilityRange = defaultDateRange(7);
      const stability = await getStabilityDistribution(stabilityRange.fromISO, stabilityRange.toISO);
      const unstableRate = stability.total ? stability.unstable / stability.total : null;
      const stabilityOk = unstableRate != null ? unstableRate <= 0.25 : false;
      const checklist = [
        {
          key: "validator_ok",
          ok: Boolean(validator?.ok),
          details: { latestRunId: validator?.id || null, latestAtISO: validator?.atISO || null },
        },
        {
          key: "top_errors",
          ok: errors.length === 0,
          details: { top: errors.slice(0, 5) },
        },
        {
          key: "p95_latency",
          ok: latencyOk,
          details: { p95ByRoute, thresholds: latencyThresholds },
        },
        {
          key: "stability_distribution",
          ok: stabilityOk,
          details: {
            range: stabilityRange,
            stable: stability.stable,
            mixed: stability.mixed,
            unstable: stability.unstable,
            total: stability.total,
            unstableRate,
          },
        },
      ];
      send(200, { ok: true, dayISO, checklist });
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
      const validatorDefault = defaultSnapshotId ? await getLatestValidatorRun("engine_matrix", defaultSnapshotId) : null;
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
          validatorOkAgainstDefault: validatorDefault ? validatorDefault.ok : false,
          validatorRunId: validatorDefault?.id || null,
        },
        snapshotCache: getSnapshotCacheStats(),
        startupSmoke: {
          lastAtISO: startupSmokeStatus.lastAtISO,
          ok: startupSmokeStatus.ok,
          lastErrorCode: startupSmokeStatus.lastErrorCode,
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

    if (pathname === "/v1/admin/stability/checklist" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const checklist = await computeStabilityChecklist();
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

    if (pathname === "/v1/admin/db/top-queries" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const limit = Number(url.searchParams.get("limit") || 10);
      const queries = getTopQueries(limit);
      send(200, { ok: true, queries });
      return;
    }

    if (pathname === "/v1/admin/db/explain" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const sql = typeof body?.sql === "string" ? body.sql.trim() : "";
      if (!sql) {
        sendError(res, 400, "sql_required", "sql is required", "sql");
        return;
      }
      if (sql.includes(";")) {
        sendError(res, 400, "sql_invalid", "Only single SELECT statements are allowed", "sql");
        return;
      }
      const upper = sql.toUpperCase();
      if (!(upper.startsWith("SELECT") || upper.startsWith("WITH"))) {
        sendError(res, 400, "sql_invalid", "Only SELECT statements are allowed", "sql");
        return;
      }
      const plan = await explainQueryPlan(sql);
      send(200, { ok: true, plan });
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
      const defaultSnapshotId = await getDefaultSnapshotId();
      const snapshotId = typeof body?.snapshotId === "string" && body.snapshotId.trim() ? body.snapshotId.trim() : defaultSnapshotId;
      if (!snapshotId) {
        sendError(res, 409, "snapshot_required", "snapshotId is required for experiments", "snapshotId");
        return;
      }
      const experiment = await createExperiment({ name, config: configValidated, status, snapshotId });
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
      if (typeof body?.snapshotId === "string" && body.snapshotId.trim()) {
        if (existing.status === "running" && body.snapshotId.trim() !== existing.snapshotId) {
          sendError(res, 409, "experiment_snapshot_locked", "Cannot change snapshot while running", "snapshotId");
          return;
        }
        patch.snapshotId = body.snapshotId.trim();
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
      const defaultSnapshotId = await getDefaultSnapshotId();
      const snapshotId = existing.snapshotId || defaultSnapshotId;
      if (!snapshotId || snapshotId !== defaultSnapshotId) {
        sendError(res, 409, "experiment_snapshot_mismatch", "Experiment snapshot must match default snapshot", "snapshotId");
        return;
      }
      const experiment = await updateExperiment(experimentId, {
        status: "running",
        snapshotId,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
      });
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
      const experiment = await updateExperiment(experimentId, {
        status: "stopped",
        stoppedAt: new Date().toISOString(),
      });
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

    const migrationExportMatch = pathname.match(/^\/v1\/admin\/migration\/export\/([^/]+)$/);
    if (migrationExportMatch && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const targetUserId = sanitizeUserId(migrationExportMatch[1]);
      if (!targetUserId || targetUserId !== migrationExportMatch[1]) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const user = await getUserById(targetUserId);
      if (!user) {
        sendError(res, 404, "user_not_found", "User not found");
        return;
      }
      const consents = await listUserConsents(targetUserId);
      const communityOpt = await getCommunityOptIn(targetUserId);
      const snapshotPin = await getUserSnapshotPin(targetUserId);
      await auditAdmin("migration.export", targetUserId, { ok: true });
      send(200, {
        ok: true,
        export: {
          userId: targetUserId,
          generatedAtISO: new Date().toISOString(),
          consents,
          snapshotPins: snapshotPin ? [snapshotPin] : [],
          outcomesHistory: [],
          communityOptIn: communityOpt?.optedIn === true,
          experiments: null,
          debugBundles: null,
        },
      });
      return;
    }

    if (pathname === "/v1/admin/migration/import" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const payload = body?.import || body;
      const targetUserId = typeof payload?.userId === "string" ? sanitizeUserId(payload.userId) : "";
      if (!targetUserId || targetUserId !== payload.userId) {
        sendError(res, 400, "userId_invalid", "userId is required", "userId");
        return;
      }
      const user = await getUserById(targetUserId);
      if (!user) {
        sendError(res, 404, "user_not_found", "User not found");
        return;
      }
      if (payload?.consents && typeof payload.consents !== "object") {
        sendError(res, 400, "consents_invalid", "consents must be object", "consents");
        return;
      }
      if (payload?.snapshotPins && !Array.isArray(payload.snapshotPins)) {
        sendError(res, 400, "snapshotPins_invalid", "snapshotPins must be array", "snapshotPins");
        return;
      }
      if (payload?.communityOptIn != null && typeof payload.communityOptIn !== "boolean") {
        sendError(res, 400, "communityOptIn_invalid", "communityOptIn must be boolean", "communityOptIn");
        return;
      }

      const consentKeys = payload?.consents ? Object.keys(payload.consents) : [];
      if (consentKeys.length) {
        await upsertUserConsents(targetUserId, consentKeys, null, await getRequiredConsentVersion());
      }

      const pins = Array.isArray(payload?.snapshotPins) ? payload.snapshotPins : [];
      if (pins.length) {
        const pin = pins[0];
        if (!pin?.snapshotId || !pin?.pinExpiresAt || !pin?.reason) {
          sendError(res, 400, "snapshotPin_invalid", "snapshot pin requires snapshotId, pinExpiresAt, reason");
          return;
        }
        await upsertUserSnapshotPin({
          userId: targetUserId,
          snapshotId: String(pin.snapshotId),
          pinnedAt: pin.pinnedAt || null,
          pinExpiresAt: String(pin.pinExpiresAt),
          reason: String(pin.reason),
        });
      }

      if (payload?.communityOptIn != null) {
        await setCommunityOptIn(targetUserId, payload.communityOptIn === true);
      }

      await auditAdmin("migration.import", targetUserId, { ok: true });
      send(200, {
        ok: true,
        userId: targetUserId,
        applied: {
          consents: consentKeys.length,
          snapshotPins: pins.length,
          communityOptIn: payload?.communityOptIn != null,
        },
      });
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

    if (pathname === "/v1/admin/support/replay" && req.method === "POST") {
      const email = await requireAdmin();
      if (!email) return;
      const body = await parseJson(req);
      const targetUserId = sanitizeUserId(body?.userId || "");
      if (!targetUserId || targetUserId !== body?.userId) {
        sendError(res, 400, "userId_invalid", "userId is invalid", "userId");
        return;
      }
      const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
      if (!snapshotId) {
        sendError(res, 400, "snapshot_required", "snapshotId is required", "snapshotId");
        return;
      }
      const limit = Math.min(Math.max(Number(body?.limit || 30), 1), 100);
      const bundle = await loadSnapshotBundle(snapshotId, { userId: targetUserId });
      if (!bundle) {
        sendError(res, 404, "snapshot_not_found", "Snapshot not found");
        return;
      }
      const snapshotState = await getUserState(targetUserId);
      let sandboxState = normalizeState(deepClone(snapshotState?.state || {}));
      try {
        validateState(sandboxState);
      } catch {
        sandboxState = normalizeState({});
      }
      const flags = await getFeatureFlags();
      const ruleConfig = buildRuleConfig(res.livenewRequestId, targetUserId);
      const paramsState = bundle.paramsState || (await getParameters(targetUserId));
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
          snapshotId,
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
      const packId = packOverride || sandboxState.userProfile?.contentPack || null;
      const experimentIds = (experimentEffects.assignments || []).map(
        (assignment) => `${assignment.experimentId}:${assignment.variantKey}`
      );
      const modelStamp = buildModelStamp({
        snapshotId,
        libraryHash: bundle.snapshot?.libraryHash || null,
        packsHash: bundle.snapshot?.packsHash || null,
        paramsVersions: paramsState.versions || {},
        packId,
        cohortId: paramsState.cohortId || null,
        experimentIds,
      });
      const contentPrefs = await loadContentPrefs(targetUserId);
      const engineGuards = resolveEngineGuards(flags, resolveIncidentMode(flags));
      const events = (await getUserEventsRecent(targetUserId, limit))
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
          library: bundle.library || domain.defaultLibrary,
          preferences: contentPrefs,
          modelStamp,
          engineGuards,
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
        library: bundle.library || domain.defaultLibrary,
        preferences: contentPrefs,
        modelStamp,
        engineGuards,
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
        if (!diff.changes?.length) continue;
        const storedRules = extractAppliedRules(storedDay);
        const sandboxRules = extractAppliedRules(sandboxDay);
        const storedDrivers = extractDrivers(storedDay);
        const sandboxDrivers = extractDrivers(sandboxDay);
        const storedSnapshotId = storedDay?.meta?.modelStamp?.snapshotId || null;
        diffs.push({
          dateISO,
          changeCount: diff.changes.length,
          changes: diff.changes.slice(0, 20),
          topAppliedRulesChanged: diffList(storedRules, sandboxRules),
          topDriverChanged: diffList(storedDrivers, sandboxDrivers),
          packMatchDelta: deltaNumber(storedDay?.why?.packMatch?.score, sandboxDay?.why?.packMatch?.score),
          confidenceDelta: deltaNumber(storedDay?.why?.confidence, sandboxDay?.why?.confidence),
          relevanceDelta: deltaNumber(storedDay?.why?.relevance, sandboxDay?.why?.relevance),
          snapshotMismatch: storedSnapshotId ? storedSnapshotId !== snapshotId : false,
        });
      }

      const summary = {
        eventsReplayed: events.length,
        affectedDates: dates,
        snapshotId,
        diffCount: diffs.length,
      };
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const redacted = redactSensitive({ snapshotId, summary, diffs });
      const debugBundle = await insertDebugBundle({ userId: targetUserId, expiresAt, redacted });
      await auditAdmin("support.replay", targetUserId, { snapshotId, events: events.length });
      send(200, { ok: true, replay: { diffs, summary, bundleId: debugBundle.id } });
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

    if (pathname === "/v1/admin/metrics/quality" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const days = normalizeMetricDays(url.searchParams.get("days"));
      const range = defaultDateRange(days);
      const counts = await getQualityMetricsRange(range.fromISO, range.toISO);
      const numerator = counts.numerator || 0;
      const denominator = counts.denominator || 0;
      const rate = denominator ? numerator / denominator : 0;
      send(200, { ok: true, days, fromISO: range.fromISO, toISO: range.toISO, numerator, denominator, rate });
      return;
    }

    if (pathname === "/v1/admin/metrics/retention" && req.method === "GET") {
      const email = await requireAdmin();
      if (!email) return;
      const days = normalizeMetricDays(url.searchParams.get("days"), [7, 14, 30], 30);
      const range = defaultDateRange(days);
      const rows = await listDay3RetentionRows(range.fromISO, range.toISO);
      const numerator = rows.filter((row) => row.retained).length;
      const denominator = rows.length;
      const overall = { numerator, denominator, rate: denominator ? numerator / denominator : 0 };

      const byCohortMap = new Map();
      rows.forEach((row) => {
        const key = row.cohortId || "unassigned";
        const entry = byCohortMap.get(key) || { cohortId: row.cohortId || null, numerator: 0, denominator: 0 };
        entry.denominator += 1;
        if (row.retained) entry.numerator += 1;
        byCohortMap.set(key, entry);
      });
      const byCohort = Array.from(byCohortMap.values()).map((entry) => ({
        ...entry,
        rate: entry.denominator ? entry.numerator / entry.denominator : 0,
      }));

      let byPack = [];
      const userIds = Array.from(new Set(rows.map((row) => row.userId)));
      const states = await listUserStatesByIds(userIds);
      const packByUser = new Map();
      states.forEach((entry) => {
        const packId = entry?.state?.userProfile?.contentPack || "unknown";
        packByUser.set(entry.userId, packId);
      });
      const byPackMap = new Map();
      rows.forEach((row) => {
        const packId = packByUser.get(row.userId) || "unknown";
        const entry = byPackMap.get(packId) || { packId, numerator: 0, denominator: 0 };
        entry.denominator += 1;
        if (row.retained) entry.numerator += 1;
        byPackMap.set(packId, entry);
      });
      byPack = Array.from(byPackMap.values()).map((entry) => ({
        ...entry,
        rate: entry.denominator ? entry.numerator / entry.denominator : 0,
      }));

      send(200, {
        ok: true,
        days,
        fromISO: range.fromISO,
        toISO: range.toISO,
        overall,
        byCohort,
        byPack,
      });
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
      if (pathname === "/v1/dev/route-hits" && req.method === "GET") {
        if (!TEST_MODE) {
          sendError(res, 404, "not_found", "Not found");
          return;
        }
        const hits = {};
        for (const [key, value] of routeHits.entries()) {
          hits[key] = value;
        }
        send(200, { ok: true, hits });
        return;
      }

      if (pathname === "/v1/dev/route-hits/reset" && req.method === "POST") {
        if (!TEST_MODE) {
          sendError(res, 404, "not_found", "Not found");
          return;
        }
        routeHits.clear();
        send(200, { ok: true });
        return;
      }

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
            snapshotId: snapshotCtx?.snapshotId || null,
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
  const smokeEnabled = config.envMode === "alpha" || config.envMode === "prod";
  scheduleStartupSmoke({
    enabled: smokeEnabled,
    delayMs: 3000,
    runReady: async () => {
      await checkReady();
    },
    runBootstrap: async () => {
      const flags = await getFeatureFlags();
      await buildBootstrapPayload({ userId: null, userProfile: null, userEmail: null, flags });
    },
    onResult: async ({ ok, errorCode }) => {
      startupSmokeStatus.lastAtISO = new Date().toISOString();
      startupSmokeStatus.ok = ok;
      startupSmokeStatus.lastErrorCode = ok ? null : errorCode || "startup_smoke_failed";
      if (!ok) {
        try {
          await setFeatureFlag("incident.mode.enabled", "true");
        } catch (err) {
          logError({ event: "startup_smoke_flag_failed", error: err?.message || String(err) });
        }
      }
    },
    log: (payload) => logError(payload),
  });
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
