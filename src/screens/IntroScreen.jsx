import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function IntroScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.top}>
          <Text style={s.logo}>LiveNew</Text>
        </View>

        <View style={s.center}>
          <Text style={s.title}>Lower your cortisol{'\n'}by tonight</Text>
          <Text style={s.body}>
            Tell Iris how you're feeling. She'll build a plan that fits your day — small changes backed by real science that add up by bedtime.
          </Text>
          <Text style={s.body}>
            No sessions. No timers. Just what to do and why it works.
          </Text>
        </View>

        <View style={s.bottom}>
          <TouchableOpacity style={s.btn} onPress={() => navigation.replace('OnboardingFlow')} activeOpacity={0.8}>
            <Text style={s.btnText}>Get started</Text>
          </TouchableOpacity>
          <Text style={s.note}>4 quick taps to your first plan</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, padding: 24, justifyContent: 'space-between' },

    top: { paddingTop: 20 },
    logo: { fontFamily: fonts.displaySemibold, fontSize: 20, color: colors.text, letterSpacing: 1 },

    center: { paddingHorizontal: 4 },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      lineHeight: 40,
      marginBottom: 20,
    },
    body: {
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.muted,
      lineHeight: 24,
      marginBottom: 12,
    },

    bottom: { paddingBottom: 16 },
    btn: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    btnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 17 },
    note: { color: colors.dim, fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginTop: 12 },
  });
}
