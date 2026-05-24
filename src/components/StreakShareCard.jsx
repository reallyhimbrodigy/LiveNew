import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../theme';
import { shareCardPalette } from './shareCardPalette';

// Instagram-story aspect ratio. Renders at FULL resolution off-screen so
// captureRef produces a sharp 1080x1920 PNG instead of the tiny 378x672
// blur the old SCALE=0.35 version was producing.
const W = 1080;
const H = 1920;

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
        {/* Soft top-right glow — adds depth without being heavy */}
        <View style={s.glow} />

        {/* Top wordmark — centered, restrained */}
        <View style={s.top}>
          <Text style={s.wordmark}>LIVENEW</Text>
        </View>

        {/* Hero block — tier label tiny, massive day number, italic subtitle */}
        <View style={s.center}>
          <Text style={s.tierLabel}>{tier.label}</Text>
          <View style={s.numberRow}>
            <Text style={s.daysNum}>{days}</Text>
          </View>
          <Text style={s.daysSuffix}>day{days === 1 ? '' : 's'} on the curve</Text>
          <Text style={s.subtitle}>{tier.subtitle}</Text>
        </View>

        {/* Bottom — Iris signature + URL, centered */}
        <View style={s.bottom}>
          <View style={s.signature}>
            <Text style={s.signatureName}>Iris</Text>
            <View style={s.signatureDot} />
          </View>
          <Text style={s.url}>livenew.app</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

function makeStyles(p) {
  return StyleSheet.create({
    outer: {
      width: W,
      height: H,
      overflow: 'hidden',
      borderRadius: 0,
    },
    bg: {
      width: '100%',
      height: '100%',
      paddingHorizontal: 72,
      paddingTop: 140,
      paddingBottom: 140,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    glow: {
      position: 'absolute',
      top: -260,
      right: -260,
      width: 720,
      height: 720,
      borderRadius: 360,
      backgroundColor: p.glow,
    },

    top: { alignItems: 'center' },
    wordmark: {
      fontFamily: fonts.displayBold,
      fontSize: 36,
      color: p.wordmark,
      letterSpacing: 10,
    },

    center: {
      alignItems: 'center',
      gap: 0,
    },
    tierLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 22,
      color: p.accent,
      letterSpacing: 5,
      marginBottom: 24,
    },
    numberRow: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    daysNum: {
      fontFamily: fonts.accentBold,
      fontSize: 480,
      color: p.accent,
      letterSpacing: -16,
      lineHeight: 480,
      textAlign: 'center',
    },
    daysSuffix: {
      fontFamily: fonts.italic,
      fontSize: 44,
      color: p.body,
      marginTop: 16,
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: fonts.italic,
      fontSize: 36,
      color: p.muted,
      marginTop: 48,
      textAlign: 'center',
      lineHeight: 50,
      paddingHorizontal: 24,
    },

    bottom: {
      alignItems: 'center',
      gap: 18,
    },
    signature: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    signatureName: {
      fontFamily: fonts.italic,
      fontSize: 38,
      color: p.accent,
      letterSpacing: 1.5,
    },
    signatureDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: p.accent,
      marginBottom: 4,
    },
    url: {
      fontFamily: fonts.displaySemibold,
      fontSize: 22,
      color: p.muted,
      letterSpacing: 4,
    },
  });
}

export { milestoneTier };
