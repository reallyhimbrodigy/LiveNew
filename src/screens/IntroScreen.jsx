import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import IrisSignature from '../components/IrisSignature';

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
          <View style={s.signatureRow}>
            <Text style={s.signaturePrefix}>Hi, I'm </Text>
            <IrisSignature size="header" />
          </View>
          <Text style={s.title}>I'll tell you{'\n'}what's actually{'\n'}happening.</Text>
          <Text style={s.body}>
            Eight moments a day. Each one a read on where your body is and exactly what to do about it.
          </Text>
          <Text style={s.body}>
            No timers. No sessions. Substance over fluff.
          </Text>
        </View>

        <View style={s.bottom}>
          <TouchableOpacity style={s.btn} onPress={() => navigation.replace('OnboardingFlow')} activeOpacity={0.8}>
            <Text style={s.btnText}>Get started</Text>
          </TouchableOpacity>
          <Text style={s.note}>3 quick taps to your first plan</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    container: { flex: 1, padding: 24, justifyContent: 'space-between' },

    top: { paddingTop: 20 },
    logo: { fontFamily: fonts.displaySemibold, fontSize: 20, color: colors.text, letterSpacing: 1 },

    center: { paddingHorizontal: 4 },
    signatureRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      marginBottom: 18,
    },
    signaturePrefix: {
      fontFamily: fonts.body,
      fontSize: 18,
      color: colors.muted,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 36,
      color: colors.text,
      lineHeight: 42,
      marginBottom: 20,
      letterSpacing: -0.4,
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
