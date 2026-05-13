import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium, tapSuccess } from '../haptics';
import IrisSignature from '../components/IrisSignature';

// Goal picker, lifted out of onboarding so first-open is faster. Reached via
// the post-plan nudge on Today (or any time from Account → Your profile).
const GOAL_OPTIONS = [
  { label: 'Sleep better', value: 'I want to sleep through the night and wake up rested', sub: 'Through the night, wake rested.' },
  { label: 'Less anxiety', value: 'I want to stop feeling anxious and overwhelmed all day', sub: 'Quiet the constant edge.' },
  { label: 'More energy', value: 'I want consistent energy throughout the day without crashing', sub: 'Steady all day, no crashes.' },
  { label: 'Lose weight', value: 'I want to lose weight and stop stress eating', sub: 'Stop the stress-eating cycle.' },
  { label: 'Be calmer', value: 'I want to feel calm and in control of my stress', sub: 'In control, not reactive.' },
  { label: 'Feel better', value: 'I just want to feel better overall', sub: 'Just better, generally.' },
];

export default function GoalPickerScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const profile = useAuthStore(z => z.profile);
  const saveProfile = useAuthStore(z => z.saveProfile);
  const [saving, setSaving] = useState(false);

  const handlePick = async (option) => {
    if (saving) return;
    tapMedium();
    setSaving(true);
    try {
      await saveProfile({ ...profile, goal: option.value });
      await AsyncStorage.setItem('livenew:goal_set_at', String(Date.now()));
      tapSuccess();
      navigation.goBack();
    } catch {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    tapMedium();
    // Mark as dismissed so the nudge stops appearing for a while.
    try { await AsyncStorage.setItem('livenew:goal_nudge_dismissed', String(Date.now())); } catch {}
    navigation.goBack();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.container}>
        <View style={s.signatureRow}>
          <IrisSignature />
          <Text style={s.signatureSuffix}>wants to dial this in</Text>
        </View>

        <Text style={s.title}>What actually matters to you?</Text>
        <Text style={s.sub}>One thing. I'll bend the plan toward it.</Text>

        <View style={s.list}>
          {GOAL_OPTIONS.map(option => (
            <Pressable
              key={option.value}
              onPress={() => handlePick(option)}
              style={({ pressed }) => [s.optionRow, pressed && { opacity: 0.85 }]}
              disabled={saving}
            >
              <View style={s.optionContent}>
                <Text style={s.optionLabel}>{option.label}</Text>
                <Text style={s.optionSub}>{option.sub}</Text>
              </View>
              <Text style={s.optionChevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={s.skipBtn} onPress={handleSkip} hitSlop={8}>
          <Text style={s.skipText}>Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },
    signatureRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 18,
    },
    signatureSuffix: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 28,
      color: colors.text,
      lineHeight: 34,
      marginBottom: 8,
      letterSpacing: -0.2,
    },
    sub: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.muted,
      marginBottom: 24,
      lineHeight: 22,
    },
    list: { gap: 10, marginTop: 8 },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      paddingVertical: 18,
      paddingHorizontal: 20,
    },
    optionContent: { flex: 1, marginRight: 8 },
    optionLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
      color: colors.text,
      letterSpacing: 0.1,
    },
    optionSub: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
      marginTop: 3,
    },
    optionChevron: {
      fontFamily: fonts.body,
      fontSize: 22,
      color: colors.gold,
      marginLeft: 8,
    },
    skipBtn: {
      alignSelf: 'center',
      marginTop: 18,
      padding: 14,
    },
    skipText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.muted,
      letterSpacing: 0.3,
    },
  });
}
