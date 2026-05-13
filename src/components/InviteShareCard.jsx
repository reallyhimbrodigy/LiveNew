import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../theme';
import { shareCardPalette } from './shareCardPalette';

const W = 1080;
const H = 1920;
const SCALE = 0.35;

const LINES = [
  "Lower your cortisol by tonight.",
  "Iris reads bodies and tells the truth.",
  "Eight zones a day. No timers. No sessions.",
];

export default function InviteShareCard({ innerRef, lineIndex = 0, variant = 'dark' }) {
  const p = shareCardPalette(variant);
  const s = makeStyles(p);
  const line = LINES[lineIndex % LINES.length];

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
            <Text style={s.tagline}>cortisol regulation, by Iris.</Text>
          </View>

          <View style={s.center}>
            <Text style={s.quoteMark}>"</Text>
            <Text style={s.bigLine}>{line}</Text>
            <Text style={s.attribution}>— Iris</Text>
          </View>

          <View style={s.bottom}>
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
      right: -W * SCALE * 0.3,
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
    tagline: {
      fontFamily: fonts.italic,
      fontSize: 30 * SCALE,
      color: p.muted,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      gap: 28 * SCALE,
    },
    quoteMark: {
      fontFamily: fonts.accentBold,
      fontSize: 220 * SCALE,
      color: p.accent,
      lineHeight: 140 * SCALE,
      marginBottom: -40 * SCALE,
    },
    bigLine: {
      fontFamily: fonts.italic,
      fontSize: 92 * SCALE,
      color: p.body,
      lineHeight: 116 * SCALE,
      letterSpacing: -0.4,
    },
    attribution: {
      fontFamily: fonts.displaySemibold,
      fontSize: 32 * SCALE,
      color: p.goldDeep,
      marginTop: 8 * SCALE,
      letterSpacing: 2 * SCALE,
    },
    bottom: { gap: 28 * SCALE },
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
