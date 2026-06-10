import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { recForToday, todaysScheduleHint } from '../domain/recommendations.js';

/**
 * RecommendationCard — displays one actionable cortisol-lowering suggestion
 * as a calm, premium card. Iris-voiced, positive, and time-of-day aware.
 *
 * Everyone gets the time-of-day rec; if their schedule has a relevant block
 * today, a tailored intro line references it. Schedule-aware tailoring is the
 * app's core hook, so it is FREE for all users (not gated behind premium).
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
  const profile = useAuthStore((s) => s.profile);
  const rec = recForToday();

  // Schedule-aware tailoring is the core hook — FREE for everyone. If today
  // has a recognizable block, add a tailored intro line referencing it.
  const hint = profile?.schedule?.blocks?.length
    ? todaysScheduleHint(profile.schedule)
    : null;

  const s = styles(colors, fonts);

  return (
    <View style={[s.card, style]}>
      <View style={s.eyebrowRow}>
        <Text style={s.eyebrow}>IRIS RECOMMENDS</Text>
        {hint ? <Text style={s.tailoredBadge}>TAILORED</Text> : null}
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <Text style={s.title}>{rec.title}</Text>
      <Text style={s.why}>{rec.why}</Text>
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
    eyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 9,
      color: colors.gold,
      letterSpacing: 2.2,
      textTransform: 'uppercase',
    },
    tailoredBadge: {
      fontFamily: fonts.displaySemibold,
      fontSize: 8,
      color: colors.gold,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      borderWidth: 0.8,
      borderColor: colors.goldBorder,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
      overflow: 'hidden',
    },
    hint: {
      fontFamily: fonts.italic,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 0.1,
      marginBottom: 4,
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
