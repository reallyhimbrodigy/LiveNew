import { useColorScheme } from 'react-native';
import { useAuthStore } from './store/authStore';

// Gold is the signature — preserved across both modes. Everything else flips.
const GOLD = '#c4a86c';

const darkColors = {
  bg: '#0f0d0a',
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

export function useTheme() {
  const systemScheme = useColorScheme();
  // themeMode is 'system' | 'light' | 'dark' (persisted in authStore).
  // 'system' follows the OS, 'light' / 'dark' override it explicitly.
  const themeMode = useAuthStore((s) => s.themeMode);
  const effectiveScheme = themeMode === 'light' || themeMode === 'dark'
    ? themeMode
    : systemScheme;
  const colors = getColors(effectiveScheme);
  return { colors, fonts, spacing, scheme: colors.scheme };
}
