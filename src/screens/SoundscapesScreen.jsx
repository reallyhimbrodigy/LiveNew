import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import SoundscapePlayer from '../components/SoundscapePlayer';
import { tapLight } from '../haptics';

// Soundscapes — moved off Today into its own calm surface. Reached via a
// subtle "Sounds" link in the Today header. Transparent background so the
// global circadian gradient shows through; header-less native push, so we
// draw our own back affordance + title.
export default function SoundscapesScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        onPress={() => { tapLight(); navigation.goBack(); }}
        hitSlop={12}
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Text style={s.backIcon}>‹</Text>
        <Text style={s.backText}>Today</Text>
      </Pressable>

      <Text style={s.title}>Soundscapes</Text>
      <Text style={s.subtitle}>
        Ambient sound to settle the nervous system. Pick one and let it run.
      </Text>

      <SoundscapePlayer onUpgrade={() => navigation.navigate('Paywall')} />
    </ScrollView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    scroll: {
      paddingHorizontal: 22,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      minHeight: 44,
      paddingRight: 12,
      gap: 4,
    },
    backIcon: {
      fontSize: 28,
      lineHeight: 30,
      color: colors.gold,
    },
    backText: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.gold,
      letterSpacing: 0.3,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 30,
      color: colors.text,
      letterSpacing: 0.2,
      marginTop: 12,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 22,
      letterSpacing: 0.1,
      marginBottom: 24,
    },
  });
}
