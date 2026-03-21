import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

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
  let finalStatus = existing;
  
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  return finalStatus === 'granted';
}

export async function scheduleSessionReminders(interventions) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!interventions || interventions.length === 0) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const item of interventions) {
    const hour = parseTimeToHour(item.moment || item.time || '');
    if (hour === null) continue;

    const triggerDate = new Date(`${today}T${String(hour).padStart(2, '0')}:00:00`);

    if (triggerDate > now) {
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title: 'LiveNew', body: item.title },
          trigger: { type: 'date', date: triggerDate },
        });
      } catch {}
    }
  }
}

function parseTimeToHour(timeStr) {
  if (!timeStr) return null;
  const lower = timeStr.toLowerCase();
  
  // Try to parse "7am", "2pm", "7:30am" etc
  const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (match) {
    let hour = parseInt(match[1]);
    if (match[3] === 'pm' && hour !== 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
    return hour;
  }
  
  // Try to match common phrases
  if (lower.includes('morning') || lower.includes('wak')) return 8;
  if (lower.includes('noon') || lower.includes('lunch') || lower.includes('midday')) return 12;
  if (lower.includes('afternoon')) return 15;
  if (lower.includes('evening') || lower.includes('dinner')) return 18;
  if (lower.includes('bed') || lower.includes('night') || lower.includes('sleep')) return 21;
  
  return null;
}
