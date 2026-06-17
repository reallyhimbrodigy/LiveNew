import React, { useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { tapSelect } from '../haptics';

// Essentials vs Premium comparison. Shows what the free tier already gives the
// user, then what going premium adds on top — ending in a single clear
// "Unlock premium" CTA that routes to the Paywall.
const ESSENTIALS = [
  'Daily personalized plan',
  '8 daily cortisol zones',
  'Streak tracking',
  'Gems',
  '3 soundscapes',
  '5 Iris chats per day',
];

const PREMIUM = [
  '12 more soundscapes — 15 total',
  'Deep progress insights',
  'Unlimited Iris chat',
  'Exclusive animated Auras',
  'Streak Freeze — your streak survives a missed day',
  'Tailored recommendations — day & time-aware picks',
];

export default function EssentialsScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const goPremium = () => {
    tapSelect();
    navigation.navigate('Paywall');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>YOUR PLAN</Text>
        <Text style={s.title}>What's included</Text>
        <Text style={s.titleAccent}>in Essentials.</Text>

        <Text style={s.sub}>
          Your plan, streak, and gems are always free. Premium adds depth — fuller access to Iris and every tool we build.
        </Text>

        {/* Free tier */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Your Essentials</Text>
            <View style={s.tagFree}>
              <Text style={s.tagFreeText}>FREE</Text>
            </View>
          </View>
          {ESSENTIALS.map((text, i) => (
            <View key={i} style={s.row}>
              <Text style={s.check}>✓</Text>
              <Text style={s.rowText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Premium tier */}
        <View style={[s.card, s.cardPremium]}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Premium adds</Text>
            <View style={s.tagPro}>
              <Text style={s.tagProText}>PRO</Text>
            </View>
          </View>
          {PREMIUM.map((text, i) => (
            <View key={i} style={s.row}>
              <Text style={s.checkGold}>✓</Text>
              <Text style={s.rowText}>{text}</Text>
            </View>
          ))}
        </View>

        <View style={s.bottom}>
          <Pressable
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]}
            onPress={goPremium}
          >
            <Text style={s.ctaText}>Unlock premium</Text>
          </Pressable>
          <Text style={s.legal}>
            Cancel any time. Manage in your Apple ID account settings.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },

    eyebrow: {
      fontFamily: fonts.displayBold,
      fontSize: 10,
      color: colors.dim,
      letterSpacing: 2,
      marginBottom: 10,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: -0.2,
      lineHeight: 38,
    },
    titleAccent: {
      fontFamily: fonts.italic,
      fontSize: 32,
      color: colors.gold,
      letterSpacing: 0.2,
      marginBottom: 16,
      lineHeight: 38,
    },
    sub: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 23,
      marginBottom: 24,
    },

    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    cardPremium: {
      borderColor: colors.goldBorder,
      backgroundColor: colors.goldSoft,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    cardTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 18,
      color: colors.text,
      letterSpacing: 0.1,
    },
    tagFree: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tagFreeText: {
      fontFamily: fonts.displayBold,
      fontSize: 9,
      color: colors.muted,
      letterSpacing: 1.6,
    },
    tagPro: {
      backgroundColor: colors.gold,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    tagProText: {
      fontFamily: fonts.displayBold,
      fontSize: 9,
      color: '#1a1612',
      letterSpacing: 1.6,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 7,
    },
    check: {
      color: colors.muted,
      fontFamily: fonts.displayBold,
      fontSize: 14,
      marginRight: 10,
      width: 18,
    },
    checkGold: {
      color: colors.gold,
      fontFamily: fonts.displayBold,
      fontSize: 14,
      marginRight: 10,
      width: 18,
    },
    rowText: {
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 14,
      flex: 1,
      lineHeight: 20,
    },

    bottom: { gap: 10, marginTop: 4 },
    cta: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 17,
      alignItems: 'center',
    },
    ctaText: {
      color: '#1a1612',
      fontFamily: fonts.displayBold,
      fontSize: 17,
      letterSpacing: 0.3,
    },
    legal: {
      color: colors.dim,
      fontFamily: fonts.body,
      fontSize: 11,
      textAlign: 'center',
      lineHeight: 16,
      marginTop: 4,
    },
  });
}
