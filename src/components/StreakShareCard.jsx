import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../theme';
import { shareCardPalette } from './shareCardPalette';

const W = 1080;
const H = 1920;
const SCALE = 0.35;

function milestoneTier(days) {
  if (days >= 100) return { label: 'CENTURY', subtitle: 'one hundred days in.' };
  if (days >= 30) return { label: 'A MONTH STRONG', subtitle: 'thirty days in a row.' };
  if (days >= 14) return { label: 'TWO WEEKS', subtitle: 'the rhythm is real.' };
  if (days >= 7) return { label: 'ONE WEEK', subtitle: 'the hardest week is done.' };
  if (days >= 3) return { label: 'GETTING STARTED', subtitle: 'three days, on the curve.' };
  return { label: 'DAY ONE', subtitle: 'just starting.' };
}

export default function StreakShareCard({ days, variant = 'dark', innerRef }) {
  const p = shareCardPalette(variant);
  const s = makeStyles(p);
  const tier = milestoneTier(days);

  return (
    <View ref={innerRef} collapsable={false} style={s.outer}>
      <LinearGradient
        colors={p.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.bg}
      >
        <View style={s.glow} />

        <View style={s.content}>
          <View style={s.top}>
            <Text style={s.wordmark}>LIVENEW</Text>
            <Text style={s.tierLabel}>{tier.label}</Text>
          </View>

          <View style={s.center}>
            <Text style={s.daysNum}>{days}</Text>
            <Text style={s.daysSuffix}>day{days === 1 ? '' : 's'}</Text>
            <Text style={s.subtitle}>{tier.subtitle}</Text>
          </View>

          <View style={s.bottom}>
            <Text style={s.attribution}>— Iris</Text>
            <View style={s.footerRow}>
              <View style={s.goldDot} />
              <Text style={s.footerText}>livenew.app</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    outer: {
      width: W * SCALE,
      height: H * SCALE,
      overflow: 'hidden',
      borderRadius: 24,
    },
    bg: { width: '100%', height: '100%' },
    glow: {
      position: 'absolute',
      top: -W * SCALE * 0.3,
      left: -W * SCALE * 0.3,
      width: W * SCALE * 0.9,
      height: W * SCALE * 0.9,
      borderRadius: W * SCALE * 0.45,
      backgroundColor: p.glow,
    },
    content: {
      flex: 1,
      padding: 44 * SCALE,
      paddingTop: 64 * SCALE,
      paddingBottom: 64 * SCALE,
      justifyContent: 'space-between',
    },
    top: { gap: 14 * SCALE },
    wordmark: {
      fontFamily: fonts.displayBold,
      fontSize: 36 * SCALE,
      color: p.wordmark,
      letterSpacing: 8 * SCALE,
    },
    tierLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26 * SCALE,
      color: p.muted,
      letterSpacing: 4 * SCALE,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'flex-start',
    },
    daysNum: {
      fontFamily: fonts.accentBold,
      fontSize: 360 * SCALE,
      color: p.accent,
      letterSpacing: -8 * SCALE,
      lineHeight: 360 * SCALE,
    },
    daysSuffix: {
      fontFamily: fonts.italic,
      fontSize: 64 * SCALE,
      color: p.body,
      marginTop: 8 * SCALE,
    },
    subtitle: {
      fontFamily: fonts.italic,
      fontSize: 48 * SCALE,
      color: p.muted,
      marginTop: 40 * SCALE,
      lineHeight: 64 * SCALE,
    },
    bottom: { gap: 28 * SCALE },
    attribution: {
      fontFamily: fonts.displaySemibold,
      fontSize: 32 * SCALE,
      color: p.goldDeep,
      letterSpacing: 2 * SCALE,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14 * SCALE,
    },
    goldDot: {
      width: 14 * SCALE,
      height: 14 * SCALE,
      borderRadius: 7 * SCALE,
      backgroundColor: p.accent,
    },
    footerText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26 * SCALE,
      color: p.muted,
      letterSpacing: 1.5 * SCALE,
    },
  });
}

export { milestoneTier };
