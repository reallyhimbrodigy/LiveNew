// Bridge that writes the current zone payload into the App Group UserDefaults
// so the iOS home-screen widget can read it. Keep the keys here in sync with
// targets/widget/index.swift.

import SharedGroupPreferences from 'react-native-shared-group-preferences';
import { Platform } from 'react-native';

const APP_GROUP = 'group.app.livenew.mobile';
const KEY_PAYLOAD = 'livenew_widget_payload_v1';

// Optional native module from expo-notifications — we use it for nothing here,
// but the widget refresh on iOS happens implicitly when UserDefaults is written
// in the shared App Group. The widget's TimelineProvider re-fetches on its own
// schedule (we set 6-hour refresh). For instant refresh we'd need a native
// WidgetCenter.shared.reloadAllTimelines() call — not exposed by RN by default.
// The 6-hour timeline + per-zone reload-on-open pattern is enough for v1.

export async function writeWidgetPayload({ headline, pullQuote, zoneLabel, score }) {
  if (Platform.OS !== 'ios') return;
  const payload = {
    headline: String(headline || ''),
    pullQuote: pullQuote ? String(pullQuote) : null,
    zoneLabel: String(zoneLabel || ''),
    score: Number.isFinite(score) ? Math.round(score) : 0,
    updatedAt: Date.now(),
  };
  try {
    await SharedGroupPreferences.setItem(KEY_PAYLOAD, JSON.stringify(payload), APP_GROUP);
  } catch (err) {
    // Silently ignore. Widget will fall back to placeholder copy.
  }
}

export async function clearWidgetPayload() {
  if (Platform.OS !== 'ios') return;
  try {
    await SharedGroupPreferences.setItem(KEY_PAYLOAD, '', APP_GROUP);
  } catch {}
}
