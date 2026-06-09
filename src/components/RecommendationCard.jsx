import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { recForToday } from '../domain/recommendations.js';

/**
 * RecommendationCard — displays one actionable cortisol-lowering suggestion
 * as a calm, premium card. Iris-voiced, positive, and time-of-day aware.
 *
 * Reads nothing from the store. The recommendation is day-stable and
 * time-biased: it changes once per calendar day and favors recs appropriate
 * to the current part of the day. No flickering on re-render.
 *
 * Props:
 *   style — additional container style (optional).
 *
 * Design intent: the COPY does the work. Same card language as CortisolFact
 * (surface bg, gold eyebrow, Manrope type) — no emoji, no exclamation marks,
 * just one calm, actionable nudge.
 */
export default function RecommendationCard({ style }) {
  const { colors, fonts } = useTheme();
  const rec = recForToday();

  return (
    <View style={[styles(colors, fonts).card, style]}>
      <Text style={styles(colors, fonts).eyebrow}>IRIS RECOMMENDS</Text>
      <Text style={styles(colors, fonts).title}>{rec.title}</Text>
      <Text style={styles(colors, fonts).why}>{rec.why}</Text>
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
    title: {
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
      color: colors.text,
      lineHeight: 24,
      letterSpacing: 0.1,
      marginBottom: 7,
    },
    why: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 20,
      letterSpacing: 0.1,
    },
  });
}
