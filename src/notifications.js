// Local push notifications for LiveNew.
//
// Two distinct categories, with independent lifecycles:
//
// 1. MORNING CHECK-IN (tag = livenew:checkin)
//    A daily-repeating notification at 7:30am that prompts the user to open
//    the app and start their day. This is the "always on" anchor — it
//    fires every morning whether or not the user has a plan yet, and is
//    the ONLY notification a user gets when they haven't checked in for
//    today.
//
// 2. ZONE NOTIFICATIONS (tag = livenew:zone)
//    One-shot notifications for each zone of today's plan, scheduled at
//    plan-generation time. These do NOT repeat. They fire once at the zone's
//    hour:minute today and are gone. This fixes the "hallucinated plan"
//    problem where yesterday's headlines kept firing on a new day before
//    the user had checked in.
//
// No backend — these are local iOS notifications via expo-notifications.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PERM_KEY = 'livenew:notif_permission';
const PREFS_KEY = 'livenew:notif_prefs_v1';
const MIGRATION_KEY = 'livenew:notif_migration_v2';
const ZONE_TAG = 'livenew:zone';
const CHECKIN_TAG = 'livenew:checkin';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Zone-time triggers. Each notification fires at the start of the zone.
export const ZONE_TIMES = {
  morning:    { hour: 6,  minute: 30 },
  peak:       { hour: 9,  minute: 0  },
  midmorning: { hour: 11, minute: 30 },
  lunch:      { hour: 13, minute: 0  },
  afternoon:  { hour: 15, minute: 0  },
  transition: { hour: 17, minute: 0  },
  winddown:   { hour: 19, minute: 30 },
  sleep:      { hour: 21, minute: 30 },
};

// Default enabled zones — high-leverage four for stress-arc coverage. User can
// flip any of the eight in settings.
const DEFAULT_ENABLED = ['peak', 'afternoon', 'winddown', 'sleep'];

// Morning check-in default time. The user is gently nudged to open the app
// and start their day.
const CHECKIN_HOUR = 7;
const CHECKIN_MINUTE = 30;

// Permission status — persisted so we can render the right CTA in settings
// without having to call into the native layer on every render.
export async function getNotificationPermission() {
  try {
    const stored = await AsyncStorage.getItem(PERM_KEY);
    if (stored) return stored;
  } catch {}
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
  } catch {}
  return 'unknown';
}

async function setStoredPermission(status) {
  try { await AsyncStorage.setItem(PERM_KEY, status); } catch {}
}

export async function requestPermissions() {
  if (!Device.isDevice) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') {
      await setStoredPermission('granted');
      return true;
    }
    const { status } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    const ok = status === 'granted';
    await setStoredPermission(ok ? 'granted' : 'denied');
    return ok;
  } catch {
    await setStoredPermission('denied');
    return false;
  }
}

// Per-zone preferences. Returns an object { [zoneId]: boolean }.
export async function getNotificationPrefs() {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      // Ensure every zone has an entry — fill missing keys with defaults.
      const filled = {};
      for (const z of Object.keys(ZONE_TIMES)) {
        filled[z] = stored[z] === undefined ? DEFAULT_ENABLED.includes(z) : !!stored[z];
      }
      return filled;
    }
  } catch {}
  const initial = {};
  for (const z of Object.keys(ZONE_TIMES)) {
    initial[z] = DEFAULT_ENABLED.includes(z);
  }
  return initial;
}

export async function setNotificationPrefs(prefs) {
  try { await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

// Cancel ONLY the zone notifications. Leaves the morning check-in (and any
// other app-scheduled notifications) intact.
async function cancelZoneNotifications() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ids = scheduled
      .filter((n) => n?.content?.data?.tag === ZONE_TAG)
      .map((n) => n.identifier);
    for (const id of ids) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {}
}

// Cancel the morning check-in reminder, if any.
async function cancelMorningCheckin() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ids = scheduled
      .filter((n) => n?.content?.data?.tag === CHECKIN_TAG)
      .map((n) => n.identifier);
    for (const id of ids) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {}
}

// Schedule per-zone notifications for TODAY ONLY (no repeats). Each fires
// once at hour:minute today and is gone — they don't haunt the user with
// stale content on subsequent mornings before they've checked in.
//
// If the zone time is already in the past for today, we skip it. The point
// of a zone notification is to anchor a moment-of-day; firing late
// undermines that.
export async function scheduleSessionReminders(zones) {
  if (!Array.isArray(zones) || zones.length === 0) return;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  const perm = await getNotificationPermission();
  if (perm !== 'granted') return;

  const prefs = await getNotificationPrefs();
  await cancelZoneNotifications();

  const now = new Date();

  for (const zone of zones) {
    if (!zone || !zone.id || !ZONE_TIMES[zone.id]) continue;
    if (!prefs[zone.id]) continue;
    const { hour, minute } = ZONE_TIMES[zone.id];
    const fireAt = new Date(now);
    fireAt.setHours(hour, minute, 0, 0);
    if (fireAt.getTime() <= now.getTime()) continue; // zone time already passed today
    const body = composeBody(zone);
    if (!body) continue;

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Iris',
          body,
          sound: 'default',
          data: { tag: ZONE_TAG, zoneId: zone.id },
        },
        // One-shot at a specific date+time. No repeats — fresh content is
        // scheduled when a new plan is generated.
        trigger: { type: 'date', date: fireAt },
      });
    } catch {}
  }
}

// Daily-repeating "good morning, time to check in" notification at 7:30am.
// This is the ALWAYS-ON anchor that prompts the user to start each new day,
// independent of whether a plan exists. Fires every day until disabled.
export async function scheduleMorningCheckin() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const perm = await getNotificationPermission();
  if (perm !== 'granted') return;

  await cancelMorningCheckin();

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Iris',
        body: 'Good morning. Tap to check in and start your day.',
        sound: 'default',
        data: { tag: CHECKIN_TAG },
      },
      trigger: {
        type: 'calendar',
        hour: CHECKIN_HOUR,
        minute: CHECKIN_MINUTE,
        repeats: true,
      },
    });
  } catch {}
}

// One-time migration: prior versions scheduled per-zone notifications with
// `repeats: true`, which made yesterday's plan keep firing every day. This
// cancels every existing zone notification on those users' devices so the
// new model (one-shot zones + daily morning check-in) can take over cleanly.
export async function migrateLegacyZoneNotifications() {
  try {
    const done = await AsyncStorage.getItem(MIGRATION_KEY);
    if (done === '1') return;
    await cancelZoneNotifications();
    await AsyncStorage.setItem(MIGRATION_KEY, '1');
  } catch {}
}

export async function cancelPlanItemNotification(zoneId) {
  // Cancel just one zone's pending notification.
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const match = scheduled.find(
      (n) => n?.content?.data?.tag === ZONE_TAG && n?.content?.data?.zoneId === zoneId,
    );
    if (match) await Notifications.cancelScheduledNotificationAsync(match.identifier);
  } catch {}
}

export async function clearAllZoneNotifications() {
  await cancelZoneNotifications();
}

// Disable the morning check-in entirely (for users who turn it off in
// settings).
export async function disableMorningCheckin() {
  await cancelMorningCheckin();
}

function composeBody(zone) {
  const headline = (zone?.headline || '').trim();
  const fallback = (zone?.pullQuote || '').trim();
  const body = (zone?.body || '').trim();

  // Prefer headline (sharp, full-sentence), then pull quote, then first
  // sentence of body as a last resort.
  if (headline && headline.length <= 180) return headline;
  if (fallback && fallback.length <= 180) return fallback;
  const firstSentence = body ? body.split(/(?<=[.!?])\s+/)[0] : '';
  return firstSentence && firstSentence.length <= 180 ? firstSentence : '';
}
