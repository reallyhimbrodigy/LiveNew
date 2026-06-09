import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { factForIndex } from '../domain/cortisolFacts.js';

/**
 * CortisolFact — displays one cortisol-consequence fact as a calm, premium card.
 *
 * Props:
 *   index  — which fact to show (optional). Defaults to a day-stable index so
 *            the card shows the same fact all day without flickering on re-render.
 *   style  — additional container style (optional).
 *
 * Design intent: the COPY does the work. The card stays on-brand (surface bg,
 * gold eyebrow, Manrope type) — no alarming colors, no red, no emoji.
 */
export default function CortisolFact({ index, style }) {
  const { colors, fonts } = useTheme();

  // Day-stable default: changes once per calendar day, stable across renders.
  const dayIndex = Math.floor(Date.now() / 86400000);
  const fact = factForIndex(index != null ? index : dayIndex);

  return (
    <View style={[styles(colors, fonts).card, style]}>
      <Text style={styles(colors, fonts).eyebrow}>CORTISOL</Text>
      <Text style={styles(colors, fonts).hook}>{fact.hook}</Text>
      <Text style={styles(colors, fonts).detail}>{fact.detail}</Text>
    </View>
  );
}

function styles(colors, fonts) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 9,
      color: colors.gold,
      letterSpacing: 2.2,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    hook: {
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
      color: colors.text,
      lineHeight: 24,
      letterSpacing: 0.1,
      marginBottom: 7,
    },
    detail: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 20,
      letterSpacing: 0.1,
    },
  });
}
