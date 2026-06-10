import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { useIsPremium } from '../store/authStore';

// View-drawn checkmark — two rotated line Views forming a check, in the gold
// accent. No emoji, no SVG dependency. Sits in a 16px-wide gutter to match the
// perk text baseline.
function CheckIcon({ color }) {
  return (
    <View style={{ width: 16, height: 19, marginRight: 8, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 11, height: 8, alignItems: 'center', justifyContent: 'center' }}>
        {/* Short stroke (lower-left) */}
        <View style={{
          position: 'absolute',
          left: 0,
          bottom: 1,
          width: 5,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }} />
        {/* Long stroke (upper-right) */}
        <View style={{
          position: 'absolute',
          right: 0,
          bottom: 2,
          width: 9,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }} />
      </View>
    </View>
  );
}

// Tasteful gold-accented upsell card shown only to non-premium users.
// Props:
//   onPress — navigate to the Paywall (or any upgrade flow)
export default function PremiumUpsell({ onPress }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const isPremium = useIsPremium();

  // Already premium — nothing to upsell
  if (isPremium) return null;

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>LIVENEW PREMIUM</Text>
      <Text style={s.title}>Go deeper with Iris.</Text>
      <Text style={s.sub}>
        Your plan, streak, and halos are always free. Premium unlocks everything else.
      </Text>

      <View style={s.perks}>
        {[
          'All soundscapes — rain, pink noise, stillness',
          'Deep progress insights and weekly deltas',
          'Unlimited Iris conversations',
          'Exclusive Aura halos (coming)',
        ].map((perk, i) => (
          <View key={i} style={s.perkRow}>
            <CheckIcon color={colors.gold} />
            <Text style={s.perkText}>{perk}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]}
        onPress={onPress}
      >
        <Text style={s.ctaText}>Go Premium</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 2.2,
      marginBottom: 8,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      color: colors.text,
      letterSpacing: -0.2,
      marginBottom: 6,
    },
    sub: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 19,
      marginBottom: 14,
    },
    perks: {
      gap: 8,
      marginBottom: 16,
    },
    perkRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    perkText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.text,
      flex: 1,
      lineHeight: 19,
    },
    cta: {
      backgroundColor: colors.gold,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignSelf: 'flex-start',
    },
    ctaText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: '#1a1612',
      letterSpacing: 0.3,
    },
  });
}
