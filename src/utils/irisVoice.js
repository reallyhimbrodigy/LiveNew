// Picks a calm, soft voice for Iris and caches the chosen identifier.
//
// Allison is Apple's softest, most measured US-English voice — commonly
// chosen for meditation apps. We try the Premium variant first (sounds
// the most natural), then Enhanced, then fall back through Ava and Samantha
// before settling for the system default. On any device where none of the
// preferred voices have been downloaded, expo-speech will use the system
// default automatically when we pass `voice: undefined`.

import * as Speech from 'expo-speech';

const PREFERENCE_ORDER = [
  'com.apple.voice.premium.en-US.Allison',
  'com.apple.voice.enhanced.en-US.Allison',
  'com.apple.voice.compact.en-US.Allison',
  'com.apple.voice.premium.en-US.Ava',
  'com.apple.voice.enhanced.en-US.Ava',
  'com.apple.ttsbundle.Allison-compact',
  'com.apple.ttsbundle.Samantha-compact',
];

let cachedVoice = undefined; // undefined = not yet looked up
let cachedAvailable = null;

async function loadAvailableVoices() {
  if (cachedAvailable) return cachedAvailable;
  try {
    cachedAvailable = await Speech.getAvailableVoicesAsync();
  } catch {
    cachedAvailable = [];
  }
  return cachedAvailable;
}

export async function pickIrisVoice() {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = await loadAvailableVoices();
  if (!voices || voices.length === 0) {
    cachedVoice = null;
    return null;
  }
  const ids = new Set(voices.map((v) => v.identifier));
  for (const id of PREFERENCE_ORDER) {
    if (ids.has(id)) { cachedVoice = id; return id; }
  }
  // No preferred voice — let expo-speech pick the system default by passing
  // `voice: undefined` later.
  cachedVoice = null;
  return null;
}

// Speak as Iris. Slightly slower rate and slightly lower pitch lean into calm.
export async function speakAsIris(text, opts = {}) {
  if (!text) return;
  const voice = (await pickIrisVoice()) || undefined;
  return Speech.speak(text, {
    voice,
    language: 'en-US',
    pitch: 0.98,
    rate: 0.92,
    ...opts,
  });
}

export function stopSpeaking() {
  try { Speech.stop(); } catch {}
}
