import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestPermissions() {
  if (!Device.isDevice) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Default notification times per zone — the inflection points where the user
// most benefits from a contextual nudge. These are floor times; the AI's
// content for that zone is what gets shown.
const ZONE_TIMES = {
  morning:    { hour: 7,  minute: 0 },
  peak:       { hour: 9,  minute: 0 },
  midmorning: { hour: 11, minute: 0 },
  lunch:      { hour: 12, minute: 30 },
  afternoon:  { hour: 15, minute: 0 },
  transition: { hour: 17, minute: 0 },
  winddown:   { hour: 19, minute: 0 },
  sleep:      { hour: 21, minute: 30 },
};

// Which zones get notifications by default. Other zones are still in the app
// (the user finds them when they open) but don't ping. This keeps daily push
// volume reasonable (~3/day) and focused on the moments where intervention
// timing actually matters.
const DEFAULT_NOTIFY_ZONES = new Set(['midmorning', 'afternoon', 'winddown']);

export async function scheduleSessionReminders(zones) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!Array.isArray(zones) || zones.length === 0) return;

  const now = new Date();
  for (const zone of zones) {
    if (!zone || typeof zone !== 'object') continue;
    if (!DEFAULT_NOTIFY_ZONES.has(zone.id)) continue;
    const t = ZONE_TIMES[zone.id];
    if (!t) continue;

    const triggerDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      t.hour,
      t.minute,
      0,
      0,
    );
    if (triggerDate <= now) continue;

    const { title, body } = composeNotificationCopy(zone);

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `livenew-zone-${zone.id}`,
        content: {
          title,
          body,
          data: { zoneId: zone.id },
        },
        trigger: { type: 'date', date: triggerDate },
      });
    } catch {}
  }
}

export async function cancelPlanItemNotification(zoneId) {
  try {
    await Notifications.cancelScheduledNotificationAsync(`livenew-zone-${zoneId}`);
  } catch {}
}

function composeNotificationCopy(zone) {
  const headline = (zone?.headline || '').trim();
  const body = (zone?.body || '').trim();
  const firstSentence = body ? body.split(/(?<=[.!?])\s+/)[0] : '';

  const notificationTitle = headline || 'LiveNew';
  // Body of the notification = first sentence of the zone (the hook). The full
  // 50-100 word zone content is read inside the app — the notification just
  // earns the open.
  const notificationBody = firstSentence && firstSentence.length < 180
    ? firstSentence
    : (body.length < 180 ? body : '');

  return { title: notificationTitle, body: notificationBody };
}
