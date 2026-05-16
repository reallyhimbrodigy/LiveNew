// Live Activity bridge — manages the iOS lockscreen + Dynamic Island
// presence for Iris's current zone.
//
// Lifecycle:
//   - start: when a plan loads and we have a current zone (from TodayScreen mount)
//   - update: when the current zone changes (every 1-2 hours as the day rolls)
//   - stop: at day rollover, on logout, or when the user explicitly skips today
//
// Uses Software Mansion's expo-live-activity package. Constrained UI:
// title + subtitle + optional progress bar + optional image. We map:
//   - title    → "Iris · {ZONE_LABEL}"
//   - subtitle → zone headline (truncated for the small layouts)
//   - progressBar.date → next zone transition time so iOS draws a countdown
//
// iOS-only. Silently no-ops on Android, Expo Go, or iOS < 16.2.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ZONE_LABELS } from './utils/score';

const ACTIVITY_ID_KEY = 'livenew:live_activity_id';

// Lazy require so this file is safe to import on platforms / build flavors
// that don't have the native module.
let LiveActivity = null;
function getLA() {
  if (LiveActivity !== null) return LiveActivity;
  if (Platform.OS !== 'ios') { LiveActivity = false; return false; }
  try {
    LiveActivity = require('expo-live-activity');
  } catch {
    LiveActivity = false;
  }
  return LiveActivity;
}

// Time windows used to compute the countdown target (next zone start).
// Mirrors the windows in utils/score.js ZONE_HOURS.
const ZONE_BOUNDS = [
  { id: 'morning',    start: 5.5, end: 8 },
  { id: 'peak',       start: 8,   end: 11 },
  { id: 'midmorning', start: 11,  end: 12.5 },
  { id: 'lunch',      start: 12.5, end: 14 },
  { id: 'afternoon',  start: 14,  end: 16 },
  { id: 'transition', start: 16,  end: 18 },
  { id: 'winddown',   start: 18,  end: 21 },
  { id: 'sleep',      start: 21,  end: 29.5 },
];

function nextZoneEndMs(currentZoneId) {
  const z = ZONE_BOUNDS.find((b) => b.id === currentZoneId);
  if (!z) return null;
  const now = new Date();
  const target = new Date(now);
  // z.end is hours-since-midnight; can wrap past 24 for the sleep zone.
  let endHour = z.end;
  if (endHour > 24) endHour -= 24;
  target.setHours(Math.floor(endHour), Math.round((endHour % 1) * 60), 0, 0);
  // If end already passed today, push to tomorrow (handles the sleep wrap).
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function buildState(zone, score) {
  if (!zone) return null;
  const label = ZONE_LABELS[zone.id] || 'Now';
  const headline = (zone.headline || '').slice(0, 90); // small layouts truncate hard
  const endMs = nextZoneEndMs(zone.id);
  return {
    title: `Iris · ${label}`,
    subtitle: score != null ? `${headline}  ·  ${score}` : headline,
    progressBar: endMs ? { date: endMs } : undefined,
  };
}

const CONFIG = {
  backgroundColor: '#0f0d0a',
  titleColor: '#c4a86c',
  subtitleColor: '#e8e0d4',
  progressViewTint: '#c4a86c',
  progressViewLabelColor: '#8a8070',
  timerType: 'digital',
  deepLinkUrl: '/today',
};

export async function startOrUpdateLiveActivity(zone, score) {
  const LA = getLA();
  if (!LA || !LA.startActivity) return;
  const state = buildState(zone, score);
  if (!state) return;
  try {
    const existingId = await AsyncStorage.getItem(ACTIVITY_ID_KEY);
    if (existingId) {
      LA.updateActivity(existingId, state);
      return;
    }
    const id = LA.startActivity(state, CONFIG);
    if (id) await AsyncStorage.setItem(ACTIVITY_ID_KEY, id);
  } catch {
    // Silently fail. Live Activity is bonus surface, not core.
  }
}

export async function endLiveActivity(zone, score) {
  const LA = getLA();
  if (!LA || !LA.stopActivity) return;
  try {
    const id = await AsyncStorage.getItem(ACTIVITY_ID_KEY);
    if (!id) return;
    const state = buildState(zone, score) || { title: 'Iris', subtitle: '' };
    LA.stopActivity(id, state);
    await AsyncStorage.removeItem(ACTIVITY_ID_KEY);
  } catch {}
}
