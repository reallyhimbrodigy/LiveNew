import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';
import { getLocalDateISO, getYesterdayISO } from '../utils/localDate';
import IrisSignature from '../components/IrisSignature';

// The morning ritual screen — appears on the first open of a new day when
// the user has no plan yet. Three elements:
//
//   1. Iris-voiced greeting
//   2. Overnight recap from HealthKit (sleep duration, HRV delta, one-line
//      interpretation). Falls back gracefully when HealthKit isn't connected.
//   3. Yesterday's reflection echo — shows the user that Iris is paying
//      attention across the day boundary.
//
// One CTA: "Start today" → routes to StressTap (check-in). Once dismissed,
// we mark today as "seen" in AsyncStorage so subsequent app opens this day
// route straight to check-in instead of looping back here.

export default function OvernightScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);

  const userName = useAuthStore(z => z.userName);
  const healthSnapshot = useAuthStore(z => z.healthSnapshot);
  const refreshHealthSnapshot = useAuthStore(z => z.refreshHealthSnapshot);
  const healthPermission = useAuthStore(z => z.healthPermission);

  const [yesterdayReflection, setYesterdayReflection] = useState(null);

  // Refresh the health snapshot the moment this screen mounts — we want the
  // freshest possible overnight data, not what was cached from yesterday.
  useEffect(() => {
    if (healthPermission === 'granted') {
      refreshHealthSnapshot().catch(() => {});
    }
  }, [healthPermission, refreshHealthSnapshot]);

  // Pull yesterday's reflection so we can echo it back.
  useEffect(() => {
    (async () => {
      try {
        const key = `livenew:reflection:${getYesterdayISO()}`;
        const r = await AsyncStorage.getItem(key);
        if (r === 'better' || r === 'same' || r === 'harder') {
          setYesterdayReflection(r);
        }
      } catch {}
    })();
  }, []);

  const sleepMin = Number.isFinite(healthSnapshot?.sleepLastNightMinutes)
    ? healthSnapshot.sleepLastNightMinutes
    : null;
  const hrvDelta = Number.isFinite(healthSnapshot?.hrvDeltaPct)
    ? healthSnapshot.hrvDeltaPct
    : null;
  const rhrDelta = Number.isFinite(healthSnapshot?.rhrDelta)
    ? healthSnapshot.rhrDelta
    : null;

  const hasSleepData = sleepMin != null || hrvDelta != null;
  const sleepHrs = sleepMin != null ? Math.floor(sleepMin / 60) : null;
  const sleepMins = sleepMin != null ? sleepMin % 60 : null;

  // One-line interpretation — opinionated, not generic. Pulls from sleep
  // duration + HRV direction.
  const interpretation = useMemo(() => {
    if (sleepMin == null && hrvDelta == null) return null;
    const shortSleep = sleepMin != null && sleepMin < 360;     // <6h
    const goodSleep  = sleepMin != null && sleepMin >= 450;    // >=7.5h
    const hrvUp      = hrvDelta != null && hrvDelta >= 5;
    const hrvDown    = hrvDelta != null && hrvDelta <= -10;

    if (hrvDown || shortSleep) {
      return "Today is for conservation, not progress.";
    }
    if (hrvUp && goodSleep) {
      return "Your nervous system is recovered. Push something today.";
    }
    if (hrvUp) {
      return "HRV is up. Body's leaning recovered.";
    }
    if (goodSleep) {
      return "Solid sleep. Steady day ahead.";
    }
    return "Steady morning. Hold the line.";
  }, [sleepMin, hrvDelta]);

  const reflectionEcho = useMemo(() => {
    if (!yesterdayReflection) return null;
    if (yesterdayReflection === 'better') return "You said yesterday felt better. Today builds on that.";
    if (yesterdayReflection === 'harder') return "You said yesterday felt harder. Today eases the load.";
    return "You said yesterday felt steady. Today holds the line.";
  }, [yesterdayReflection]);

  const handleStart = async () => {
    tapMedium();
    const today = getLocalDateISO();
    try { await AsyncStorage.setItem('livenew:seen_overnight_date', today); } catch {}
    navigation.replace('StressTap');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.brandRow}>
          <IrisSignature size="header" />
        </View>

        <Text style={s.greeting}>
          Good morning{userName ? `, ${userName}` : ''}.
        </Text>

        {hasSleepData ? (
          <View style={s.recapCard}>
            <Text style={s.recapLabel}>OVERNIGHT</Text>

            {sleepMin != null ? (
              <View style={s.recapRow}>
                <Text style={s.recapBig}>
                  {sleepHrs}<Text style={s.recapUnit}>h </Text>{sleepMins}<Text style={s.recapUnit}>m</Text>
                </Text>
                <Text style={s.recapBigLabel}>of sleep</Text>
              </View>
            ) : null}

            {(hrvDelta != null || rhrDelta != null) ? (
              <View style={s.recapMetrics}>
                {hrvDelta != null ? (
                  <View style={s.recapMetric}>
                    <Text style={s.recapMetricValue}>
                      {hrvDelta > 0 ? '+' : ''}{hrvDelta}%
                    </Text>
                    <Text style={s.recapMetricLabel}>HRV vs baseline</Text>
                  </View>
                ) : null}
                {rhrDelta != null ? (
                  <View style={s.recapMetric}>
                    <Text style={s.recapMetricValue}>
                      {rhrDelta > 0 ? '+' : ''}{rhrDelta}
                    </Text>
                    <Text style={s.recapMetricLabel}>RHR bpm vs baseline</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {interpretation ? (
              <>
                <View style={s.recapDivider} />
                <Text style={s.recapInterpretation}>{interpretation}</Text>
              </>
            ) : null}
          </View>
        ) : (
          <Text style={s.noDataLine}>
            Last night was the close. Today's the open.
          </Text>
        )}

        {reflectionEcho ? (
          <Text style={s.reflectionEcho}>{reflectionEcho}</Text>
        ) : null}

        <View style={{ flex: 1 }} />

        <Pressable
          style={({ pressed }) => [s.startBtn, pressed && { opacity: 0.88 }]}
          onPress={handleStart}
        >
          <Text style={s.startBtnText}>Start today</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: {
      flexGrow: 1,
      padding: 24,
      paddingTop: 32,
      paddingBottom: 32,
    },

    brandRow: {
      marginBottom: 22,
    },

    greeting: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: -0.3,
      lineHeight: 38,
      marginBottom: 24,
    },

    // Recap card
    recapCard: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 16,
      padding: 20,
      marginBottom: 18,
    },
    recapLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 11,
      color: colors.gold,
      letterSpacing: 1.8,
      marginBottom: 14,
    },
    recapRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    recapBig: {
      fontFamily: fonts.displayBold,
      fontSize: 44,
      color: colors.text,
      letterSpacing: -0.6,
      lineHeight: 50,
    },
    recapUnit: {
      fontFamily: fonts.italic,
      fontSize: 22,
      color: colors.muted,
      letterSpacing: 0.2,
    },
    recapBigLabel: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.muted,
      marginLeft: 4,
    },
    recapMetrics: {
      flexDirection: 'row',
      gap: 24,
      marginTop: 12,
    },
    recapMetric: {
      flex: 1,
    },
    recapMetricValue: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      color: colors.gold,
      letterSpacing: -0.2,
    },
    recapMetricLabel: {
      fontFamily: fonts.body,
      fontSize: 11,
      color: colors.muted,
      letterSpacing: 0.3,
      marginTop: 2,
    },
    recapDivider: {
      height: 1,
      backgroundColor: colors.goldBorder,
      marginTop: 18,
      marginBottom: 14,
    },
    recapInterpretation: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
      letterSpacing: 0.1,
    },

    noDataLine: {
      fontFamily: fonts.italic,
      fontSize: 16,
      color: colors.muted,
      lineHeight: 25,
      marginBottom: 18,
      paddingLeft: 14,
      borderLeftWidth: 2,
      borderLeftColor: colors.gold,
    },

    reflectionEcho: {
      fontFamily: fonts.italic,
      fontSize: 14,
      color: colors.muted,
      lineHeight: 21,
      letterSpacing: 0.1,
      marginBottom: 18,
    },

    startBtn: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 17,
      alignItems: 'center',
    },
    startBtnText: {
      color: '#1a1612',
      fontFamily: fonts.displayBold,
      fontSize: 17,
      letterSpacing: 0.3,
    },
  });
}
