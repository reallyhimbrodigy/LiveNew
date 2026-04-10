import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function IntroScreen({ navigation }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.top}>
          <Text style={s.logo}>LiveNew</Text>
        </View>

        <View style={s.center}>
          <Text style={s.title}>Lower your cortisol{'\n'}by tonight</Text>
          <Text style={s.body}>
            Tell us how you're feeling. We'll build a plan that fits your day — small changes backed by real science that add up by bedtime.
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: 24, justifyContent: 'space-between' },

  top: { paddingTop: 20 },
  logo: { fontSize: 20, fontWeight: '500', color: colors.text, letterSpacing: 1 },

  center: { paddingHorizontal: 4 },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 40,
    marginBottom: 20,
  },
  body: {
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
  btnText: { color: colors.bg, fontSize: 17, fontWeight: '600' },
  note: { color: colors.dim, fontSize: 13, textAlign: 'center', marginTop: 12 },
});
