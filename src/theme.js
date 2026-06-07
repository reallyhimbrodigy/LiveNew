import { useColorScheme } from 'react-native';
import { useAuthStore } from './store/authStore';

// Gold is the signature — preserved across both modes. Everything else flips.
const GOLD = '#c4a86c';

const darkColors = {
  bg: '#0f0d0a',
  // Background gradient (top → bottom). A deep, warm, near-black wash with a
  // touch of plum at the very bottom so the screen reads as depth, not flat
  // black, and the gold accent glows against it. Subtle on purpose.
  bgGradient: ['#1a150d', '#100d09', '#0b0809'],
  ringTrack: 'rgba(196,168,108,0.10)',  // faint track behind the state-ring arc
  ringGlow: 'rgba(196,168,108,0.16)',   // soft halo behind the ring center
  card: '#161412',
  surface: '#1c1a17',
  gold: GOLD,
  // A slightly darker gold used where the brand gold needs more contrast on
  // light backgrounds. Same hue, deeper saturation — reads as "the brand
  // color" but passes WCAG AA against cream.
  goldDeep: GOLD,
  goldDim: 'rgba(196,168,108,0.12)',
  goldSoft: 'rgba(196,168,108,0.06)',
  goldBorder: 'rgba(196,168,108,0.2)',
  text: '#e8e0d4',
  muted: '#8a8070',
  dim: '#5a5248',
  line: 'rgba(196,168,108,0.1)',
  error: '#c97a7a',
  errorBg: 'rgba(200,80,80,0.1)',
  errorBorder: 'rgba(201,122,122,0.3)',
  success: '#7aad7a',
  successBg: 'rgba(122,173,122,0.15)',
  accent: '#8a8acd',
  tabBar: '#111110',
  modalOverlay: 'rgba(0,0,0,0.72)',
  scheme: 'dark',
};

const lightColors = {
  bg: '#faf5ec',
  // Warm cream gradient — barely-there depth that keeps the surface feeling
  // crafted rather than a flat fill, mirroring the dark-mode treatment.
  bgGradient: ['#fdf9f1', '#faf5ec', '#f2e8d6'],
  ringTrack: 'rgba(138,111,58,0.14)',
  ringGlow: 'rgba(196,168,108,0.22)',
  card: '#ffffff',
  surface: '#fefcf7',
  gold: GOLD,
  // Darker gold for text/accents on cream — passes contrast where the brand
  // gold alone would wash out (gold #c4a86c on cream = 1.6:1, fails WCAG AA).
  goldDeep: '#8a6f3a',
  goldDim: 'rgba(196,168,108,0.18)',
  goldSoft: 'rgba(196,168,108,0.08)',
  goldBorder: 'rgba(196,168,108,0.45)',
  text: '#2a2620',
  muted: '#6b6357',
  dim: '#a59f93',
  line: 'rgba(42,38,32,0.08)',
  error: '#b85555',
  errorBg: 'rgba(184,85,85,0.08)',
  errorBorder: 'rgba(184,85,85,0.25)',
  success: '#4a8a4a',
  successBg: 'rgba(74,138,74,0.1)',
  accent: '#5a5aa8',
  tabBar: '#ffffff',
  modalOverlay: 'rgba(42,38,32,0.45)',
  scheme: 'light',
};

// Manrope is the primary type — rounded sans, modern, Gen-Z-coded.
// Lora is preserved ONLY for accent moments (big score number, occasional
// italic accents) where serif character earns its keep.
export const fonts = {
  display: 'Manrope_500Medium',
  displaySemibold: 'Manrope_600SemiBold',
  displayBold: 'Manrope_700Bold',
  body: 'Manrope_400Regular',
  italic: 'Lora_400Regular_Italic',
  accent: 'Lora_500Medium',
  accentBold: 'Lora_700Bold',
  // Backwards-compat alias used by some screens.
  displayItalic: 'Lora_400Regular_Italic',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Backwards-compat export. Screens that haven't migrated to useTheme() still
// import { colors } — they'll get dark mode (the previous behavior). New code
// must use useTheme().
export const colors = darkColors;

export function getColors(scheme) {
  return scheme === 'light' ? lightColors : darkColors;
}

// ─── Circadian background ────────────────────────────────────────────────
// The app background gradient shifts hue through the day — warm at the
// morning cortisol peak, neutral midday, cooling into a deep indigo at night.
// All stops stay near-black (dark) / near-cream (light): this is *depth and
// warmth*, not a color show. It's an on-brand expression of the circadian
// thesis the whole product is built on — and the thing a flat black bg can't do.
export function circadianPhase(hour) {
  if (hour < 5.5 || hour >= 21) return 'night';
  if (hour < 10) return 'morning';
  if (hour < 16) return 'midday';
  return 'evening';
}

const CIRCADIAN = {
  dark: {
    morning: ['#1b150c', '#120d08', '#0c0907'], // warm amber-black
    midday:  ['#15120e', '#100d0a', '#0b0908'], // neutral warm charcoal
    evening: ['#16110f', '#100b0d', '#0a080a'], // dusky plum
    night:   ['#0e0f15', '#0a0a10', '#08080d'], // cool indigo-black
  },
  light: {
    morning: ['#fdf8ee', '#faf4e9', '#f3ead9'],
    midday:  ['#fdfbf4', '#faf6ed', '#f2ecde'],
    evening: ['#faf6f1', '#f4efe9', '#ebe5df'],
    night:   ['#f1eee8', '#eae6df', '#e2dcd4'],
  },
};

export function getCircadianGradient(scheme, hour) {
  const table = scheme === 'light' ? CIRCADIAN.light : CIRCADIAN.dark;
  return table[circadianPhase(hour)];
}

// Soft elevation for cards/surfaces. Subtle in dark (a deep ambient lift),
// lighter in light mode. Spread into a card style: `...shadows[scheme]`.
export const shadows = {
  dark:  { shadowColor: '#000000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  light: { shadowColor: '#2a2620', shadowOpacity: 0.10, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
};

export function useTheme() {
  // Locked to dark. LiveNew's identity is gold-on-warm-dark (it's literally the
  // app icon), and the circadian gradient + state ring are tuned for it. The
  // light palette and getColors('light') stay in the codebase for share cards
  // and any future use, but the app no longer exposes a light/dark switch — so
  // every user sees the intended look. Flip this one line to 'light' or restore
  // the system/themeMode logic if that ever changes.
  const effectiveScheme = 'dark';
  const colors = getColors(effectiveScheme);
  return { colors, fonts, spacing, scheme: colors.scheme };
}
