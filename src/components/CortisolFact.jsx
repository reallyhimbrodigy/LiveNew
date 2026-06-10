import React, { useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { factForIndex, CORTISOL_FACTS } from '../domain/cortisolFacts.js';

/**
 * CortisolFact — displays one cortisol-consequence fact as a calm, premium card.
 * Tapping the card advances to the next fact (cycles through CORTISOL_FACTS).
 *
 * Props:
 *   index  — which fact to show initially (optional). Defaults to a day-stable
 *            index so the card shows the same fact all day on first render.
 *   style  — additional container style (optional).
 *
 * Design intent: the COPY does the work. The card stays on-brand (surface bg,
 * gold eyebrow, Manrope type) — no alarming colors, no red, no emoji.
 * Tapping cycles facts so the card earns every revisit.
 */
export default function CortisolFact({ index, style }) {
  const { colors, fonts } = useTheme();

  // Day-stable default: changes once per calendar day, stable across renders.
  const dayIndex = Math.floor(Date.now() / 86400000);
  const startIndex = index != null ? index : dayIndex;

  const [offset, setOffset] = useState(0);

  const fact = factForIndex(startIndex + offset);

  const s = makeStyles(colors, fonts);

  const handlePress = () => {
    setOffset(prev => prev + 1);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Tap for another cortisol fact"
    >
      <Text style={s.eyebrow}>CORTISOL</Text>
      <Text style={s.hook}>{fact.hook}</Text>
      <Text style={s.detail}>{fact.detail}</Text>
      <Text style={s.tapHint}>Tap for another fact</Text>
    </Pressable>
  );
}

function makeStyles(colors, fonts) {
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
      marginBottom: 10,
    },
    tapHint: {
      fontFamily: fonts.italic,
      fontSize: 11,
      color: colors.dim,
      letterSpacing: 0.3,
      alignSelf: 'flex-end',
    },
  });
}
