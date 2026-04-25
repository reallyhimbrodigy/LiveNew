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

// Cancel + schedule a notification for each plan item at its exact HH:MM time today.
// Items are expected to have a `time` field in 24-hour HH:MM (set server-side by aiDayPlan).
// Falls back to natural-language parsing of `moment` if `time` missing (legacy plans).
//
// Notification copy strategy: title is the moment (specific, contextual hook),
// body leads with the insight's first sentence (the WHY) which is more compelling
// than the title verbatim. The user wants a notification that earns the open,
// not a chore reminder.
export async function scheduleSessionReminders(planItems) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!Array.isArray(planItems) || planItems.length === 0) return;

  const now = new Date();
  for (let i = 0; i < planItems.length; i++) {
    const item = planItems[i];
    const { hour, minute } = parsePlanTime(item) || {};
    if (hour == null) continue;

    const triggerDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0,
    );
    if (triggerDate <= now) continue;

    const { title, body } = composeNotificationCopy(item);

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `livenew-plan-${i}`,
        content: {
          title,
          body,
          data: { planIndex: i },
        },
        trigger: { type: 'date', date: triggerDate },
      });
    } catch {}
  }
}

function composeNotificationCopy(item) {
  const moment = (item?.moment || '').trim();
  const title = (item?.title || '').trim();
  const insight = (item?.insight || '').trim();

  // Pull the first sentence of the insight as the notification body.
  // This is usually the observation/hook ("Most people crash because..."),
  // which is far more interesting than just the moment phrase.
  const firstSentence = insight ? insight.split(/(?<=[.!?])\s+/)[0] : '';

  // Title prefers the moment (the WHEN/WHERE — concrete, contextual);
  // falls back to title if moment is missing.
  const notificationTitle = moment || title || 'LiveNew';

  // Body is the action + brief why. If we have an insight, lead with its
  // first sentence + the title; otherwise just the title.
  let notificationBody;
  if (firstSentence && firstSentence.length < 140) {
    notificationBody = title ? `${title}. ${firstSentence}` : firstSentence;
  } else {
    notificationBody = title || '';
  }

  return { title: notificationTitle, body: notificationBody };
}

// Cancel a single plan item's notification (e.g., when user taps "Got it").
export async function cancelPlanItemNotification(index) {
  try {
    await Notifications.cancelScheduledNotificationAsync(`livenew-plan-${index}`);
  } catch {}
}

function parsePlanTime(item) {
  // Preferred: explicit time field set by AI ("HH:MM")
  if (typeof item?.time === 'string') {
    const m = item.time.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return { hour, minute };
      }
    }
  }

  // Legacy fallback: parse natural-language moment text
  const text = (item?.moment || '').toLowerCase();
  if (!text) return null;

  const ampm = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2] ? Number(ampm[2]) : 0;
    if (ampm[3] === 'pm' && hour !== 12) hour += 12;
    if (ampm[3] === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }

  const hhmm = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) {
    let hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (hour <= 5) hour += 12;
    return { hour, minute };
  }

  if (/wake|morning/.test(text)) return { hour: 7, minute: 0 };
  if (/lunch|noon|midday/.test(text)) return { hour: 12, minute: 0 };
  if (/afternoon/.test(text)) return { hour: 15, minute: 0 };
  if (/dinner|evening/.test(text)) return { hour: 18, minute: 30 };
  if (/wind\s*down|bed|sleep|night/.test(text)) return { hour: 21, minute: 30 };
  return null;
}
