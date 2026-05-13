import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts } from '../theme';

// 9:16 share card — rendered into a hidden RN view, captured by react-native-view-shot.
// Supports two visual variants:
//   - "dark"  (default): near-black gradient + gold accents. Punches on any social feed.
//   - "cream": warm cream gradient + deep-gold accents. Brand-consistent with light mode,
//              softer Lemme/Bloom Gen Z wellness vibe.
const W = 1080;
const H = 1920;
const SCALE = 0.35;

function palette(variant) {
  if (variant === 'cream') {
    return {
      gradient: ['#fbf5e6', '#f0e4c5'],
      glow: 'rgba(196,168,108,0.28)',
      wordmark: '#8a6f3a',
      zoneLabel: '#6b6357',
      quoteMark: '#c4a86c',
      pullQuote: '#2a2620',
      attribution: '#8a6f3a',
      scoreNum: '#8a6f3a',
      scoreLabel: '#6b6357',
      goldDot: '#c4a86c',
      footerText: '#6b6357',
    };
  }
  // dark (default)
  return {
    gradient: ['#1a1612', '#0f0d0a'],
    glow: 'rgba(196,168,108,0.18)',
    wordmark: '#c4a86c',
    zoneLabel: '#8a8070',
    quoteMark: '#c4a86c',
    pullQuote: '#e8e0d4',
    attribution: '#c4a86c',
    scoreNum: '#c4a86c',
    scoreLabel: '#8a8070',
    goldDot: '#c4a86c',
    footerText: '#8a8070',
  };
}

export default function ShareCard({ headline, pullQuote, zoneLabel, score, variant = 'dark', innerRef }) {
  const p = palette(variant);
  const s = makeStyles(p);

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
            <Text style={s.zoneLabel}>{(zoneLabel || '').toUpperCase()}</Text>
          </View>

          <View style={s.center}>
            <Text style={s.quoteMark}>"</Text>
            <Text style={s.pullQuote}>{pullQuote || headline}</Text>
            <Text style={s.attribution}>— Iris</Text>
          </View>

          <View style={s.bottom}>
            {score != null ? (
              <View style={s.scoreRow}>
                <Text style={s.scoreNum}>{score}</Text>
                <Text style={s.scoreLabel}>TODAY'S SCORE</Text>
              </View>
            ) : null}
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
    zoneLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26 * SCALE,
      color: p.zoneLabel,
      letterSpacing: 4 * SCALE,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      gap: 28 * SCALE,
    },
    quoteMark: {
      fontFamily: fonts.accentBold,
      fontSize: 220 * SCALE,
      color: p.quoteMark,
      lineHeight: 140 * SCALE,
      marginBottom: -40 * SCALE,
    },
    pullQuote: {
      fontFamily: fonts.italic,
      fontSize: 80 * SCALE,
      color: p.pullQuote,
      lineHeight: 108 * SCALE,
      letterSpacing: -0.4,
    },
    attribution: {
      fontFamily: fonts.displaySemibold,
      fontSize: 32 * SCALE,
      color: p.attribution,
      marginTop: 8 * SCALE,
      letterSpacing: 2 * SCALE,
    },
    bottom: { gap: 28 * SCALE },
    scoreRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 16 * SCALE,
    },
    scoreNum: {
      fontFamily: fonts.accentBold,
      fontSize: 96 * SCALE,
      color: p.scoreNum,
      letterSpacing: -2 * SCALE,
    },
    scoreLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 22 * SCALE,
      color: p.scoreLabel,
      letterSpacing: 3 * SCALE,
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
      backgroundColor: p.goldDot,
    },
    footerText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 26 * SCALE,
      color: p.footerText,
      letterSpacing: 1.5 * SCALE,
    },
  });
}
