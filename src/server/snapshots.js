import { addDaysISO, weekStartMonday } from "../domain/utils/date.js";
import { toDateISOWithBoundary } from "../domain/utils/time.js";
import { getDefaultParameters, validateParamValue } from "./parameters.js";
import {
  getContentSnapshot,
  listContentSnapshotItems,
  listContentSnapshotPacks,
  listContentSnapshotParams,
  getSnapshotMeta,
  upsertSnapshotMeta,
  getUserSnapshotPin,
  upsertUserSnapshotPin,
  listCohortParameters,
  getUserCohort,
} from "../state/db.js";

const SNAPSHOT_CACHE = new Map();
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const META_TTL_MS = 10 * 1000;
let defaultSnapshotCache = { value: null, loadedAt: 0 };
let snapshotCacheStats = { hits: 0, misses: 0 };

function normalizeExpiryDateISO(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function computeNextWeekBoundaryISO(dateISO) {
  const weekStart = weekStartMonday(dateISO);
  return addDaysISO(weekStart, 7);
}

export async function getDefaultSnapshotId() {
  const now = Date.now();
  if (defaultSnapshotCache.loadedAt && now - defaultSnapshotCache.loadedAt < META_TTL_MS) {
    return defaultSnapshotCache.value || null;
  }
  const meta = await getSnapshotMeta("default_snapshot_id");
  defaultSnapshotCache = { value: meta || null, loadedAt: now };
  return meta || null;
}

export async function setDefaultSnapshotId(snapshotId) {
  if (!snapshotId) return null;
  const value = String(snapshotId);
  await upsertSnapshotMeta("default_snapshot_id", value);
  defaultSnapshotCache = { value, loadedAt: Date.now() };
  return value;
}

function buildLibrary(items) {
  const library = { workouts: [], nutrition: [], resets: [] };
  (items || []).forEach((entry) => {
    const item = entry.item || entry;
    const kind = entry.kind || item?.kind;
    if (!item || !kind) return;
    if (kind === "workout") library.workouts.push(item);
    if (kind === "nutrition") library.nutrition.push(item);
    if (kind === "reset") library.resets.push(item);
  });
  return library;
}

async function buildParamsFromSnapshot({ params = [], packs = [], userId }) {
  const map = getDefaultParameters();
  const versions = {};
  const baseVersions = {};
  const cohortVersions = {};
  const errors = [];
  const seen = new Set();

  params.forEach((row) => {
    const key = row.key;
    if (!key) return;
    seen.add(key);
    if (validateParamValue(key, row.value)) {
      map[key] = row.value;
      versions[key] = row.version;
      baseVersions[key] = row.version;
    } else {
      errors.push(`Invalid parameter: ${key}`);
      versions[key] = row.version;
      baseVersions[key] = row.version;
    }
  });

  Object.keys(map).forEach((key) => {
    if (!seen.has(key)) {
      versions[key] = versions[key] || 0;
      baseVersions[key] = baseVersions[key] || 0;
    }
  });

  if (packs.length) {
    const weights = {};
    const constraints = {};
    packs.forEach((pack) => {
      weights[pack.id] = pack.weights || {};
      constraints[pack.id] = pack.constraints || {};
    });
    map.contentPackWeights = weights;
    map.contentPackConstraints = constraints;
    versions.contentPackWeights = versions.contentPackWeights || 0;
    baseVersions.contentPackWeights = baseVersions.contentPackWeights || 0;
  }

  let cohortId = null;
  if (userId) {
    const cohort = await getUserCohort(userId);
    cohortId = cohort?.cohortId || null;
    if (cohortId) {
      const overrides = await listCohortParameters(cohortId);
      overrides.forEach((row) => {
        const key = row.key;
        if (!key) return;
        if (validateParamValue(key, row.value)) {
          map[key] = row.value;
          versions[key] = row.version;
          cohortVersions[key] = row.version;
        } else {
          errors.push(`Invalid cohort parameter: ${key}`);
          cohortVersions[key] = row.version;
        }
      });
    }
  }

  return {
    map,
    versions,
    versionsBySource: { base: baseVersions, cohort: cohortVersions },
    ok: errors.length === 0,
    errors,
    loadedAt: Date.now(),
    cohortId,
  };
}

export async function loadSnapshotBundle(snapshotId, { userId } = {}) {
  if (!snapshotId) return null;
  const cached = SNAPSHOT_CACHE.get(snapshotId);
  const now = Date.now();
  if (cached && now - cached.loadedAt < SNAPSHOT_TTL_MS) {
    snapshotCacheStats.hits += 1;
    return cached.value;
  }
  snapshotCacheStats.misses += 1;

  const snapshot = await getContentSnapshot(snapshotId);
  if (!snapshot) return null;
  const items = await listContentSnapshotItems(snapshotId);
  const packs = await listContentSnapshotPacks(snapshotId);
  const params = await listContentSnapshotParams(snapshotId);
  const library = buildLibrary(items);
  const paramsState = await buildParamsFromSnapshot({ params, packs, userId });

  const bundle = {
    snapshot,
    items,
    packs,
    params,
    library,
    paramsState,
  };
  SNAPSHOT_CACHE.set(snapshotId, { loadedAt: now, value: bundle });
  return bundle;
}

export async function resolveSnapshotForUser({ userId, userProfile, overrideSnapshotId, allowLive }) {
  if (allowLive && !overrideSnapshotId) {
    return { snapshotId: null, source: "live" };
  }
  if (overrideSnapshotId) {
    return { snapshotId: overrideSnapshotId, source: "override" };
  }
  const defaultSnapshotId = await getDefaultSnapshotId();
  if (!defaultSnapshotId) {
    return { snapshotId: null, source: "missing_default" };
  }
  if (!userId) {
    return { snapshotId: defaultSnapshotId, source: "default" };
  }
  const tz = userProfile?.timezone || "UTC";
  const todayISO = toDateISOWithBoundary(new Date(), tz, 0);
  const pin = await getUserSnapshotPin(userId);
  const expiresISO = normalizeExpiryDateISO(pin?.pinExpiresAt);
  if (pin?.snapshotId && expiresISO && todayISO < expiresISO) {
    return { snapshotId: pin.snapshotId, source: "pin", pinExpiresAt: pin.pinExpiresAt };
  }
  const nextBoundaryISO = computeNextWeekBoundaryISO(todayISO);
  await upsertUserSnapshotPin({
    userId,
    snapshotId: defaultSnapshotId,
    pinnedAt: new Date().toISOString(),
    pinExpiresAt: nextBoundaryISO,
    reason: "weekly_pin",
  });
  return { snapshotId: defaultSnapshotId, source: "new_pin", pinExpiresAt: nextBoundaryISO };
}

export async function repinUserSnapshot({ userId, snapshotId, userProfile, reason = "manual" }) {
  if (!userId || !snapshotId) return null;
  const tz = userProfile?.timezone || "UTC";
  const todayISO = toDateISOWithBoundary(new Date(), tz, 0);
  const nextBoundaryISO = computeNextWeekBoundaryISO(todayISO);
  await upsertUserSnapshotPin({
    userId,
    snapshotId,
    pinnedAt: new Date().toISOString(),
    pinExpiresAt: nextBoundaryISO,
    reason,
  });
  return { snapshotId, pinExpiresAt: nextBoundaryISO };
}

export function clearSnapshotCache(snapshotId = null) {
  if (snapshotId) {
    SNAPSHOT_CACHE.delete(snapshotId);
  } else {
    SNAPSHOT_CACHE.clear();
  }
}

export function getSnapshotCacheStats() {
  return {
    entries: SNAPSHOT_CACHE.size,
    hits: snapshotCacheStats.hits,
    misses: snapshotCacheStats.misses,
  };
}
