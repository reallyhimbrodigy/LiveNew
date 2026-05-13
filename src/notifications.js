// Local push notifications for each of the eight zones.
//
// Strategy: scheduled fresh every time a plan is generated/loaded. Cancels any
// previously scheduled zone notifications, then schedules one local push per
// enabled zone for *today* — using each zone's headline as the body and "Iris"
// as the sender.
//
// No server involved — these are local notifications (iOS UNUserNotification via
// expo-notifications). That means no backend, no APNS setup, no cost. The
// trade-off: content is fixed at schedule time. For per-zone hooks on a daily
// app, that's the right call.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PERM_KEY = 'livenew:notif_permission';
const PREFS_KEY = 'livenew:notif_prefs_v1';
const TAG = 'livenew:zone';

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

// Cancel only the notifications we've tagged as zone notifications. Leaves any
// other app-scheduled notifications intact.
async function cancelZoneNotifications() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ids = scheduled
      .filter((n) => n?.content?.data?.tag === TAG)
      .map((n) => n.identifier);
    for (const id of ids) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {}
}

// Schedule a notification per enabled zone using its headline as the body.
// Uses a DAILY-repeating calendar trigger so reminders keep firing even if
// the user doesn't open the app to regenerate a plan. The content (headline)
// is fixed at schedule time — when a new plan generates, we cancel-and-
// reschedule with the fresh headlines.
export async function scheduleSessionReminders(zones) {
  if (!Array.isArray(zones) || zones.length === 0) return;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  const perm = await getNotificationPermission();
  if (perm !== 'granted') return;

  const prefs = await getNotificationPrefs();
  await cancelZoneNotifications();

  for (const zone of zones) {
    if (!zone || !zone.id || !ZONE_TIMES[zone.id]) continue;
    if (!prefs[zone.id]) continue;
    const { hour, minute } = ZONE_TIMES[zone.id];
    const body = composeBody(zone);

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Iris',
          body,
          sound: 'default',
          data: { tag: TAG, zoneId: zone.id },
        },
        // Daily-repeating trigger. Fires at hour:minute every day until
        // explicitly cancelled or rescheduled.
        trigger: { type: 'calendar', hour, minute, repeats: true },
      });
    } catch {}
  }
}

export async function cancelPlanItemNotification(zoneId) {
  // Cancel just one zone's pending notification.
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const match = scheduled.find(
      (n) => n?.content?.data?.tag === TAG && n?.content?.data?.zoneId === zoneId,
    );
    if (match) await Notifications.cancelScheduledNotificationAsync(match.identifier);
  } catch {}
}

export async function clearAllZoneNotifications() {
  await cancelZoneNotifications();
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
