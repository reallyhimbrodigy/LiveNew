// Apple HealthKit wrapper.
//
// We pull sleep duration, resting heart rate, HRV, heart rate, steps, and
// active energy. The data is summarized into a "health snapshot" that can be
// passed to the AI prompt and used to recalibrate the LiveNew score.
//
// Defensive about missing data: users without Apple Watch may only have steps
// and basic heart rate. The wrapper returns nulls for missing fields and the
// rest of the system falls back to self-report.
//
// iOS only. On Android the module is a no-op.
//
// Built on @kingstinct/react-native-healthkit (Nitro Modules) — actively
// maintained and built for the New Architecture / bridgeless mode. The
// previous library (react-native-health) used RCT_EXPORT_MODULE which doesn't
// register under bridgeless RN 0.81; that's why "Connect Apple Health"
// returned "not available" all the way through build #67.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HEALTH_CACHE_KEY = 'livenew:health_snapshot_v1';
const HEALTH_PERM_KEY = 'livenew:health_permission_status';

// HealthKit type identifiers — passed as strings to the new lib's typed APIs.
const HRV_ID = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const RHR_ID = 'HKQuantityTypeIdentifierRestingHeartRate';
const HR_ID  = 'HKQuantityTypeIdentifierHeartRate';
const STEPS_ID = 'HKQuantityTypeIdentifierStepCount';
const ACTIVE_ENERGY_ID = 'HKQuantityTypeIdentifierActiveEnergyBurned';
const SLEEP_ID = 'HKCategoryTypeIdentifierSleepAnalysis';

const READ_TYPES = [HRV_ID, RHR_ID, HR_ID, STEPS_ID, ACTIVE_ENERGY_ID, SLEEP_ID];

// CategoryValueSleepAnalysis values from the new library:
// 0 = inBed, 1 = asleepUnspecified/asleep, 2 = awake,
// 3 = asleepCore, 4 = asleepDeep, 5 = asleepREM
// We treat 1, 3, 4, 5 as actual sleep (anything but inBed/awake).
const SLEEP_ASLEEP_VALUES = new Set([1, 3, 4, 5]);

// Lazy require — keeps this file safe to import on non-iOS or when the native
// module is unavailable for any reason. Surfaces the failure reason for
// diagnostics; never throws at module-load time.
let healthkit = null;
let HEALTHKIT_LOAD_ERROR = null;
if (Platform.OS === 'ios') {
  try {
    healthkit = require('@kingstinct/react-native-healthkit');
    if (!healthkit?.requestAuthorization || !healthkit?.queryQuantitySamples) {
      HEALTHKIT_LOAD_ERROR = `Module loaded but core methods missing (keys: ${Object.keys(healthkit || {}).slice(0, 8).join(',')})`;
      healthkit = null;
    }
  } catch (err) {
    HEALTHKIT_LOAD_ERROR = err?.message || String(err);
    healthkit = null;
  }
}

export function getHealthKitLoadError() {
  return HEALTHKIT_LOAD_ERROR;
}

export async function isHealthAvailable() {
  if (Platform.OS !== 'ios' || !healthkit) return false;
  try {
    if (typeof healthkit.isHealthDataAvailableAsync === 'function') {
      return await healthkit.isHealthDataAvailableAsync();
    }
    if (typeof healthkit.isHealthDataAvailable === 'function') {
      return !!healthkit.isHealthDataAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

// Returns "granted" | "denied" | "unknown". iOS doesn't reliably tell us the
// authorization state for read-only access (privacy by design), so we use the
// presence of any data after a request as a heuristic, and persist our last
// known state.
export async function getHealthPermissionStatus() {
  try {
    const stored = await AsyncStorage.getItem(HEALTH_PERM_KEY);
    if (stored) return stored;
  } catch {}
  return 'unknown';
}

export async function setHealthPermissionStatus(status) {
  try { await AsyncStorage.setItem(HEALTH_PERM_KEY, status); } catch {}
}

// Returns { ok: boolean, error: string|null }. ok=true means the native
// HealthKit auth sheet ran to completion (either grant or deny — iOS doesn't
// distinguish for read-only access). error is non-null only on hard failures
// (native module not loaded, framework not available, etc.).
export async function requestHealthPermissions() {
  if (!healthkit) {
    const msg = HEALTHKIT_LOAD_ERROR
      ? `HealthKit module didn't load: ${HEALTHKIT_LOAD_ERROR}`
      : 'HealthKit is only available on iOS devices.';
    return { ok: false, error: msg };
  }
  try {
    await healthkit.requestAuthorization({ read: READ_TYPES, write: [] });
    // Probe for actual data to infer whether the user granted anything.
    // iOS hides per-permission status for read access (privacy by design).
    try {
      const probe = await fetchHealthSnapshot(2);
      const anyData = probe && (
        probe.sleepLast7Avg != null ||
        probe.rhrLast7Avg != null ||
        probe.hrvLast7Avg != null ||
        probe.stepsYesterday != null
      );
      await setHealthPermissionStatus(anyData ? 'granted' : 'unknown');
    } catch {
      await setHealthPermissionStatus('unknown');
    }
    return { ok: true, error: null };
  } catch (err) {
    await setHealthPermissionStatus('denied');
    return { ok: false, error: String(err?.message || err) };
  }
}

// Pull last N days of data. Returns a summary "snapshot" the rest of the app
// can consume. All fields nullable.
export async function fetchHealthSnapshot(days = 7) {
  if (!healthkit) return null;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 86400000);
  const baseOptions = {
    filter: { date: { startDate, endDate } },
    limit: -1,
    ascending: true,
  };

  const [sleep, rhr, hrv, hr, steps, active] = await Promise.all([
    safeCategoryQuery(SLEEP_ID, baseOptions),
    safeQuantityQuery(RHR_ID, { ...baseOptions, unit: 'count/min' }),
    safeQuantityQuery(HRV_ID, { ...baseOptions, unit: 'ms' }),
    safeQuantityQuery(HR_ID,  { ...baseOptions, unit: 'count/min' }),
    safeQuantityQuery(STEPS_ID, { ...baseOptions, unit: 'count' }),
    safeQuantityQuery(ACTIVE_ENERGY_ID, { ...baseOptions, unit: 'kcal' }),
  ]);

  // Sleep: aggregate per-night total in minutes (asleep states only).
  const asleep = sleep.filter((s) => SLEEP_ASLEEP_VALUES.has(s.value));
  const nightTotals = aggregateSleepPerNight(asleep);
  const lastNight = nightTotals.length > 0 ? nightTotals[nightTotals.length - 1] : null;
  const sleepAvg7 = avg(nightTotals.slice(-7).map((n) => n.minutes));

  // HRV: latest + 7-day avg + delta vs older baseline.
  const hrvNumeric = hrv.map((s) => s.quantity).filter((v) => Number.isFinite(v));
  const hrvLast = hrvNumeric.length > 0 ? hrvNumeric[hrvNumeric.length - 1] : null;
  const hrvAvg7 = avg(hrvNumeric.slice(-7));
  const hrvBaseline = avg(hrvNumeric.slice(0, Math.max(1, hrvNumeric.length - 7)));
  const hrvDeltaPct = (hrvBaseline && hrvAvg7)
    ? Math.round(((hrvAvg7 - hrvBaseline) / hrvBaseline) * 100)
    : null;

  // Resting HR: latest + 7-day avg + delta vs older baseline.
  const rhrNumeric = rhr.map((s) => s.quantity).filter((v) => Number.isFinite(v));
  const rhrLast = rhrNumeric.length > 0 ? rhrNumeric[rhrNumeric.length - 1] : null;
  const rhrAvg7 = avg(rhrNumeric.slice(-7));
  const rhrBaseline = avg(rhrNumeric.slice(0, Math.max(1, rhrNumeric.length - 7)));
  const rhrDelta = (rhrBaseline && rhrAvg7) ? Math.round(rhrAvg7 - rhrBaseline) : null;

  // Steps: aggregate by day, take yesterday (second-to-last day).
  const stepsByDay = aggregateQuantityByDay(steps);
  const stepsDays = Object.keys(stepsByDay).sort();
  const stepsYesterday = stepsDays.length >= 2
    ? stepsByDay[stepsDays[stepsDays.length - 2]]
    : null;

  // Active energy: same shape — aggregate by day, take yesterday.
  const activeByDay = aggregateQuantityByDay(active);
  const activeDays = Object.keys(activeByDay).sort();
  const activeYesterdayKcal = activeDays.length >= 2
    ? activeByDay[activeDays[activeDays.length - 2]]
    : null;

  // Latest heart rate sample (instant value).
  const hrNumeric = hr.map((s) => s.quantity).filter((v) => Number.isFinite(v));
  const hrLatest = hrNumeric.length > 0 ? hrNumeric[hrNumeric.length - 1] : null;

  return {
    fetchedAt: Date.now(),
    sleepLastNightMinutes: lastNight ? Math.round(lastNight.minutes) : null,
    sleepLast7Avg: sleepAvg7 ? Math.round(sleepAvg7) : null,
    hrvLast: hrvLast ? Math.round(hrvLast) : null,
    hrvLast7Avg: hrvAvg7 ? Math.round(hrvAvg7) : null,
    hrvDeltaPct,
    rhrLast: rhrLast ? Math.round(rhrLast) : null,
    rhrLast7Avg: rhrAvg7 ? Math.round(rhrAvg7) : null,
    rhrDelta,
    stepsYesterday: stepsYesterday ? Math.round(stepsYesterday) : null,
    activeYesterdayKcal: activeYesterdayKcal ? Math.round(activeYesterdayKcal) : null,
    hrLatest: hrLatest ? Math.round(hrLatest) : null,
  };
}

// Cache wrapper — call this to get the snapshot, refreshing if stale.
export async function getHealthSnapshot({ maxAgeMinutes = 60 } = {}) {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      const age = (Date.now() - (cached.fetchedAt || 0)) / 60000;
      if (age < maxAgeMinutes) return cached;
    }
  } catch {}

  const fresh = await fetchHealthSnapshot(14);
  if (fresh) {
    try { await AsyncStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(fresh)); } catch {}
  }
  return fresh;
}

// Helpers

async function safeQuantityQuery(typeIdentifier, options) {
  try {
    const res = await healthkit.queryQuantitySamples(typeIdentifier, options);
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

async function safeCategoryQuery(typeIdentifier, options) {
  try {
    const res = await healthkit.queryCategorySamples(typeIdentifier, options);
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

function aggregateQuantityByDay(samples) {
  const byDay = {};
  for (const s of samples) {
    if (!Number.isFinite(s.quantity)) continue;
    const day = toISODate(s.startDate);
    if (!day) continue;
    byDay[day] = (byDay[day] || 0) + s.quantity;
  }
  return byDay;
}

function aggregateSleepPerNight(samples) {
  if (samples.length === 0) return [];
  const byDate = {};
  for (const s of samples) {
    const startMs = toTime(s.startDate);
    const endMs = toTime(s.endDate);
    if (startMs == null || endMs == null) continue;
    const minutes = (endMs - startMs) / 60000;
    if (minutes <= 0 || minutes > 16 * 60) continue;
    const dayKey = toISODate(s.startDate);
    if (!dayKey) continue;
    byDate[dayKey] = (byDate[dayKey] || 0) + minutes;
  }
  return Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minutes]) => ({ date, minutes }));
}

function toTime(d) {
  if (!d) return null;
  if (d instanceof Date) return d.getTime();
  const parsed = new Date(d).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toISODate(d) {
  const t = toTime(d);
  if (t == null) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function avg(arr) {
  const valid = arr.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
