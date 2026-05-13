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

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HEALTH_CACHE_KEY = 'livenew:health_snapshot_v1';
const HEALTH_PERM_KEY = 'livenew:health_permission_status';

// react-native-health exports the class as the module's default (ES) AND
// as the bare module export (CommonJS). The previous `.default` access was
// hitting undefined on some build modes — that's why the Connect button
// silently did nothing in build #35.
let AppleHealthKit = null;
let HEALTHKIT_LOAD_ERROR = null;
if (Platform.OS === 'ios') {
  try {
    const mod = require('react-native-health');
    AppleHealthKit = mod?.default || mod;
    if (!AppleHealthKit || !AppleHealthKit.initHealthKit) {
      HEALTHKIT_LOAD_ERROR = `Module loaded but initHealthKit is missing (keys: ${Object.keys(mod || {}).join(',')})`;
      AppleHealthKit = null;
    }
  } catch (err) {
    HEALTHKIT_LOAD_ERROR = err?.message || String(err);
    AppleHealthKit = null;
  }
}

export function getHealthKitLoadError() {
  return HEALTHKIT_LOAD_ERROR;
}

const HK_PERMISSIONS = AppleHealthKit
  ? {
      permissions: {
        read: [
          AppleHealthKit.Constants.Permissions.SleepAnalysis,
          AppleHealthKit.Constants.Permissions.HeartRate,
          AppleHealthKit.Constants.Permissions.RestingHeartRate,
          AppleHealthKit.Constants.Permissions.HeartRateVariability,
          AppleHealthKit.Constants.Permissions.StepCount,
          AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
        ],
        write: [],
      },
    }
  : null;

export async function isHealthAvailable() {
  if (Platform.OS !== 'ios' || !AppleHealthKit) return false;
  return new Promise((resolve) => {
    AppleHealthKit.isAvailable((err, available) => {
      if (err || !available) return resolve(false);
      resolve(true);
    });
  });
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
  if (!AppleHealthKit || !HK_PERMISSIONS) {
    const msg = HEALTHKIT_LOAD_ERROR
      ? `HealthKit module didn't load: ${HEALTHKIT_LOAD_ERROR}`
      : 'HealthKit is only available on iOS devices.';
    return { ok: false, error: msg };
  }
  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(HK_PERMISSIONS, async (err) => {
      if (err) {
        await setHealthPermissionStatus('denied');
        return resolve({ ok: false, error: String(err?.message || err) });
      }
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
      resolve({ ok: true, error: null });
    });
  });
}

// Pull last N days of data. Returns a summary "snapshot" the rest of the app
// can consume. All fields nullable.
export async function fetchHealthSnapshot(days = 7) {
  if (!AppleHealthKit) return null;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 86400000);

  const [sleep, rhr, hrv, hr, steps, active] = await Promise.all([
    safeQuery((cb) =>
      AppleHealthKit.getSleepSamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        cb,
      ),
    ),
    safeQuery((cb) =>
      AppleHealthKit.getRestingHeartRateSamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString(), unit: 'bpm' },
        cb,
      ),
    ),
    safeQuery((cb) =>
      AppleHealthKit.getHeartRateVariabilitySamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        cb,
      ),
    ),
    safeQuery((cb) =>
      AppleHealthKit.getHeartRateSamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString(), unit: 'bpm' },
        cb,
      ),
    ),
    safeQuery((cb) =>
      AppleHealthKit.getDailyStepCountSamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        cb,
      ),
    ),
    safeQuery((cb) =>
      AppleHealthKit.getActiveEnergyBurned(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        cb,
      ),
    ),
  ]);

  // Sleep: aggregate per-night total in minutes (asleep states only).
  const nightTotals = aggregateSleepPerNight(sleep);
  const lastNight = nightTotals.length > 0 ? nightTotals[nightTotals.length - 1] : null;
  const sleepAvg7 = avg(nightTotals.slice(-7).map((n) => n.minutes));

  // HRV: take latest value + 7-day average (typically one reading per night).
  const hrvNumeric = (hrv || []).map((s) => s.value).filter((v) => Number.isFinite(v));
  const hrvLast = hrvNumeric.length > 0 ? hrvNumeric[hrvNumeric.length - 1] : null;
  const hrvAvg7 = avg(hrvNumeric.slice(-7));
  const hrvBaseline = avg(hrvNumeric.slice(0, Math.max(1, hrvNumeric.length - 7))); // older window
  const hrvDeltaPct = (hrvBaseline && hrvAvg7)
    ? Math.round(((hrvAvg7 - hrvBaseline) / hrvBaseline) * 100)
    : null;

  // Resting HR: latest + average + delta vs older baseline.
  const rhrNumeric = (rhr || []).map((s) => s.value).filter((v) => Number.isFinite(v));
  const rhrLast = rhrNumeric.length > 0 ? rhrNumeric[rhrNumeric.length - 1] : null;
  const rhrAvg7 = avg(rhrNumeric.slice(-7));
  const rhrBaseline = avg(rhrNumeric.slice(0, Math.max(1, rhrNumeric.length - 7)));
  const rhrDelta = (rhrBaseline && rhrAvg7) ? Math.round(rhrAvg7 - rhrBaseline) : null;

  // Steps yesterday (most recent full day).
  const stepsArr = (steps || []).filter((s) => Number.isFinite(s.value));
  const stepsYesterday = stepsArr.length >= 2 ? stepsArr[stepsArr.length - 2].value : null;

  // Active calories yesterday.
  const activeArr = (active || []).filter((s) => Number.isFinite(s.value));
  const activeYesterdayKcal = activeArr.length >= 2 ? activeArr[activeArr.length - 2].value : null;

  // Most recent heart rate (last sample).
  const hrArr = (hr || []).filter((s) => Number.isFinite(s.value));
  const hrLatest = hrArr.length > 0 ? hrArr[hrArr.length - 1].value : null;

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

function safeQuery(invoke) {
  return new Promise((resolve) => {
    try {
      invoke((err, results) => {
        if (err) return resolve([]);
        resolve(Array.isArray(results) ? results : []);
      });
    } catch {
      resolve([]);
    }
  });
}

function aggregateSleepPerNight(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  // Treat anything that isn't INBED as asleep time.
  const asleep = samples.filter((s) => s.value && s.value !== 'INBED');
  // Group by date the sleep STARTED (most sleep crosses midnight; group by start date)
  const byDate = {};
  for (const s of asleep) {
    const start = new Date(s.startDate).toISOString().slice(0, 10);
    const minutes = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000;
    if (minutes <= 0 || minutes > 16 * 60) continue;
    byDate[start] = (byDate[start] || 0) + minutes;
  }
  const sorted = Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minutes]) => ({ date, minutes }));
  return sorted;
}

function avg(arr) {
  const valid = arr.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
