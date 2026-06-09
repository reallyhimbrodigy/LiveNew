// Local push notifications for LiveNew.
//
// Two categories, separately tagged so they never interfere:
//
// 1. CHECK-IN REMINDERS (tag = livenew:checkin)
//    Cortisol-aware "tap to check in" prompts that fire at the natural
//    inflection points of the day (morning / midday / afternoon / evening).
//    Scheduled as RECURRING DAILY triggers — they fire every day at their set
//    time with NO app-open required. (The prior model used one-shot dates
//    re-built on each app open, which meant missing an app-open meant missing
//    that day's notifications — users saw "one morning ping, then nothing.")
//    The copy is time-of-day based, not plan-specific, so a daily repeat never
//    goes stale. Always on while notifications are permitted.
//
// 2. ZONE NOTIFICATIONS (tag = livenew:zone)
//    One-shot, today-only notifications scheduled when a plan generates.
//    Each fires once at its zone time with that zone's headline. They
//    do NOT repeat. On a new day without a check-in, they don't fire —
//    no hallucinated stale content.
//
// Defensive: on every app open, if there's no plan for today, we cancel
// every zone notification (anything from yesterday that somehow lingered
// is wiped out before it can fire).

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PERM_KEY = 'livenew:notif_permission';
const PREFS_KEY = 'livenew:notif_prefs_v1';
const MIGRATION_KEY = 'livenew:notif_migration_v3';
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

// Zone-time triggers used when a plan exists for today.
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

const DEFAULT_ENABLED = ['peak', 'afternoon', 'winddown', 'sleep'];

// Check-in reminder slots — cortisol-aware inflection points where a user
// who hasn't checked in benefits from a nudge. The body copy is written
// for THAT moment of the day; tapping any of them opens the app, which
// either shows today's plan or routes to the check-in flow.
const CHECKIN_SLOTS = [
  { id: 'morning',  hour: 7,  minute: 30, body: "Good morning. Tap to check in and start your day with Iris." },
  { id: 'midday',   hour: 11, minute: 30, body: "Midmorning dip — the first natural cortisol crash. Tap to set the curve." },
  { id: 'afternoon', hour: 14, minute: 0, body: "Afternoon crash window. One protocol can flip it." },
  { id: 'evening',  hour: 18, minute: 30, body: "Evening begins. Tap to set tonight up." },
];


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

export async function getNotificationPrefs() {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
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

// Cancel ONLY zone notifications.
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

// Cancel ONLY check-in reminders.
async function cancelCheckInNotifications() {
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
// If the zone time is already in the past for today, we skip it.
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
    if (fireAt.getTime() <= now.getTime()) continue;
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
        trigger: { type: 'date', date: fireAt },
      });
    } catch {}
  }
}

// Schedule the day's check-in nudges as RECURRING DAILY notifications.
//
// Why daily-repeating (not one-shot dates): the previous model scheduled
// one-shot `date` triggers a few days ahead and re-built them on every app
// open. That meant the throughout-the-day cadence depended on the user opening
// the app — miss a day's open and you'd miss that day's notifications, and
// generating a plan suppressed the rest of the day entirely. Users got "one
// morning ping, then nothing." A repeating DAILY trigger fires every day at
// the set time with NO app-open required, so the cadence is reliable. The copy
// is time-of-day based (not plan-specific), so a daily repeat never goes stale.
//
// This is idempotent: it cancels existing check-in reminders and re-creates
// the four daily triggers. Safe to call on every app open / plan generation.
// `opts` is accepted for backward-compat with existing callers but ignored —
// the nudges are always on (the user explicitly wants throughout-the-day pings).
export async function scheduleCheckInReminders(_opts = {}) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const perm = await getNotificationPermission();
  if (perm !== 'granted') return;

  await cancelCheckInNotifications();

  for (const slot of CHECKIN_SLOTS) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Iris',
          body: slot.body,
          sound: 'default',
          data: { tag: CHECKIN_TAG, slot: slot.id },
        },
        // Repeating daily calendar trigger — fires every day at hour:minute.
        trigger: { type: 'daily', hour: slot.hour, minute: slot.minute },
      });
    } catch {}
  }
}

// Defensive: on every app open, if there's no plan for today, cancel any
// zone notifications that somehow lingered (e.g., from a build version
// that scheduled daily-repeating). Prevents hallucinated stale-plan
// firings on a new day before the user has checked in.
export async function clearStaleZoneNotificationsIfNoPlanToday(hasPlanToday) {
  if (!hasPlanToday) {
    await cancelZoneNotifications();
  }
}

// One-time migration to nuke any legacy daily-repeating zone notifications
// scheduled by builds prior to the one-shot model. Idempotent.
export async function migrateLegacyZoneNotifications() {
  try {
    const done = await AsyncStorage.getItem(MIGRATION_KEY);
    if (done === '1') return;
    await cancelZoneNotifications();
    await cancelCheckInNotifications();
    await AsyncStorage.setItem(MIGRATION_KEY, '1');
  } catch {}
}

export async function cancelPlanItemNotification(zoneId) {
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

export async function disableCheckInReminders() {
  await cancelCheckInNotifications();
}

function composeBody(zone) {
  const headline = (zone?.headline || '').trim();
  const fallback = (zone?.pullQuote || '').trim();
  const body = (zone?.body || '').trim();

  if (headline && headline.length <= 180) return headline;
  if (fallback && fallback.length <= 180) return fallback;
  const firstSentence = body ? body.split(/(?<=[.!?])\s+/)[0] : '';
  return firstSentence && firstSentence.length <= 180 ? firstSentence : '';
}
