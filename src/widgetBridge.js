// Bridge between the JS day plan and the iOS widget extension.
//
// What we write: the FULL day's plan (each zone's id, label, headline, and
// time window), the day's score, and today's dateISO. The widget reads this
// once per WidgetCenter refresh and computes which zone is "current" by
// comparing the system clock to each zone window — so the displayed zone
// changes throughout the day without the host app having to re-write.
//
// "No plan today" UX: if the widget reads a payload whose dateISO ≠ today
// (e.g. user hasn't checked in yet on a new day), it shows a "Tap to check
// in" prompt. So we don't need to clear the payload on day rollover —
// staleness is the signal.
//
// Key + payload schema MUST stay in sync with targets/widget/index.swift.

import SharedGroupPreferences from 'react-native-shared-group-preferences';
import { Platform, NativeModules } from 'react-native';
import { ZONE_LABELS } from './utils/score';

const APP_GROUP = 'group.app.livenew.mobile';
const KEY_PAYLOAD = 'livenew_widget_payload_v2';

// Mirror of ZONE_HOURS in src/utils/score.js. Kept inline here so the widget
// bridge has no cross-file dependency at this layer.
const ZONE_HOURS = {
  morning:    { start: 5.5,  end: 8 },
  peak:       { start: 8,    end: 11 },
  midmorning: { start: 11,   end: 12.5 },
  lunch:      { start: 12.5, end: 14 },
  afternoon:  { start: 14,   end: 16 },
  transition: { start: 16,   end: 18 },
  winddown:   { start: 18,   end: 21 },
  sleep:      { start: 21,   end: 29.5 }, // wraps past midnight
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Reload the widget timelines so the new payload takes effect immediately
// rather than waiting up to ~6h for iOS's next scheduled refresh. This needs
// the native WidgetCenter API; we call it via a tiny native module exposed
// by the host app (best-effort — silently no-op if it's not present).
function reloadWidgetTimelines() {
  try {
    const w = NativeModules.WidgetCenter || NativeModules.RNWidgetCenter;
    if (w && typeof w.reloadAllTimelines === 'function') {
      w.reloadAllTimelines();
    }
  } catch {}
}

// Write the FULL day's plan. Called whenever a new plan generates or the
// app loads a cached plan for today. `zones` is the array from the AI plan
// contract (each zone has at minimum { id, headline }).
export async function writeDayWidgetPayload({ zones, score }) {
  if (Platform.OS !== 'ios') return;
  if (!Array.isArray(zones) || zones.length === 0) return;
  const slots = zones
    .filter((z) => z && z.id && ZONE_HOURS[z.id])
    .map((z) => ({
      id: z.id,
      label: ZONE_LABELS[z.id] || z.id,
      headline: String(z.headline || '').slice(0, 200),
      startHour: ZONE_HOURS[z.id].start,
      endHour: ZONE_HOURS[z.id].end,
    }));
  if (slots.length === 0) return;
  const payload = {
    dateISO: todayISO(),
    score: Number.isFinite(score) ? Math.round(score) : 0,
    zones: slots,
    updatedAt: Date.now(),
  };
  try {
    await SharedGroupPreferences.setItem(KEY_PAYLOAD, JSON.stringify(payload), APP_GROUP);
    reloadWidgetTimelines();
  } catch {
    // Silently ignore — widget will fall back to "check in" empty state.
  }
}

// Legacy single-zone shape used by older builds. Kept as a thin compat layer
// so existing callers in TodayScreen don't break; internally it just calls
// the new full-day writer. The single-zone caller can pass its own zones[]
// from todayPlan if it has them.
export async function writeWidgetPayload({ zones, score }) {
  if (!zones) return;
  return writeDayWidgetPayload({ zones, score });
}

export async function clearWidgetPayload() {
  if (Platform.OS !== 'ios') return;
  try {
    await SharedGroupPreferences.setItem(KEY_PAYLOAD, '', APP_GROUP);
    reloadWidgetTimelines();
  } catch {}
}
