import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';
import IrisSignature from '../components/IrisSignature';
import { deriveFromHealth, canSkipSleepAndEnergy } from '../utils/healthInference';

// Onboarding step machine:
//   0 — Apple Health (always asked, FIRST)
//   1 — Goal (6 chips)
//   2 — Schedule (free-text typed input — needed for real personalization)
//   3 — Stress (always asked, subjective)
//   4 — Sleep  (SKIPPED if HealthKit granted with data)
//   5 — Energy (SKIPPED if HealthKit granted with data)
//
// Total steps shown in the progress bar adapts: 4 for HealthKit-granted users,
// 6 for users who decline HealthKit.

const GOAL_OPTIONS = [
  { label: 'Sleep better',  value: 'I want to sleep through the night and wake up rested' },
  { label: 'Less anxiety',  value: 'I want to stop feeling anxious and overwhelmed all day' },
  { label: 'More energy',   value: 'I want consistent energy throughout the day without crashing' },
  { label: 'Lose weight',   value: 'I want to lose weight and stop stress eating' },
  { label: 'Be calmer',     value: 'I want to feel calm and in control of my stress' },
  { label: 'Feel better',   value: 'I want to feel better in my body, day to day' },
];

const STRESS_OPTIONS = [
  { label: 'Good',         value: 'good',         sub: 'calm, steady' },
  { label: 'Okay',         value: 'okay',         sub: 'a little tense' },
  { label: 'Stressed',     value: 'stressed',     sub: 'on edge' },
  { label: 'Overwhelmed',  value: 'overwhelmed',  sub: 'too much at once' },
];

const SLEEP_OPTIONS = [
  { label: 'Great', value: 'great', sub: 'rested' },
  { label: 'OK',    value: 'okay',  sub: 'enough to function' },
  { label: 'Rough', value: 'rough', sub: 'tired before today started' },
];

const ENERGY_OPTIONS = [
  { label: 'High',   value: 'high',   sub: 'sharp and ready' },
  { label: 'Medium', value: 'medium', sub: 'steady' },
  { label: 'Low',    value: 'low',    sub: 'dragging' },
];

function PressRow({ onPress, children, s }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={() => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 60, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 60, bounciness: 4 }).start()}
        onPress={onPress}
        style={s.optionRow}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// Messages cycle indefinitely so the screen never goes static while the AI
// is still working. Six messages × 3s = 18s before repeating — long enough
// that the user doesn't feel a loop, short enough to always have movement.
const LOADING_MESSAGES = [
  'Reading your signals…',
  'Pulling your cortisol pattern…',
  'Mapping the curve…',
  'Finding what matters today…',
  'Building zone by zone…',
  'Iris is being thorough…',
];

function LoadingAnimation({ loadingStyles }) {
  const [tick, setTick] = useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  const message = LOADING_MESSAGES[tick % LOADING_MESSAGES.length];
  return (
    <View style={loadingStyles.wrap}>
      <View style={loadingStyles.dotsRow}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[loadingStyles.dot, { opacity: tick % 3 === i ? 1 : 0.2 }]} />
        ))}
      </View>
      <Text style={loadingStyles.message}>{message}</Text>
    </View>
  );
}

export default function OnboardingScreen() {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const loadingStyles = useMemo(() => makeLoadingStyles(colors, fonts), [colors, fonts]);

  const healthPermission = useAuthStore(z => z.healthPermission);
  const healthSnapshot = useAuthStore(z => z.healthSnapshot);
  const connectHealth = useAuthStore(z => z.connectHealth);
  const saveProfileWithoutNav = useAuthStore(z => z.saveProfileWithoutNav);
  const generatePlan = useAuthStore(z => z.generatePlan);
  const activateProfile = useAuthStore(z => z.activateProfile);

  // Derived: skip sleep + energy questions when HealthKit gives us the data.
  const healthDerived = useMemo(() => deriveFromHealth(healthSnapshot), [healthSnapshot]);
  const skipSleepEnergy = canSkipSleepAndEnergy(healthSnapshot);

  const [step, setStep] = useState(0); // 0=Health, 1=Goal, 2=Schedule, 3=Stress, 4=Sleep, 5=Energy
  const [goal, setGoal] = useState(null);
  const [routine, setRoutine] = useState('');
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connectingHealth, setConnectingHealth] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const animateTransition = (callback) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      callback();
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  // Step 0 — Apple Health
  const handleConnectHealth = async () => {
    if (connectingHealth) return;
    tapMedium();
    setConnectingHealth(true);
    await connectHealth();
    setConnectingHealth(false);
    // Whether granted or not, advance to Goal. We re-check skipSleepEnergy at
    // generation time using the live store state.
    animateTransition(() => setStep(1));
  };
  const handleSkipHealth = () => {
    tapMedium();
    useAuthStore.setState({ healthPermission: 'denied' });
    require('../healthkit').setHealthPermissionStatus('denied').catch(() => {});
    animateTransition(() => setStep(1));
  };

  // Step 1 — Goal
  const handleGoal = (option) => {
    tapMedium();
    setGoal(option.value);
    animateTransition(() => setStep(2));
  };

  // Step 2 — Schedule
  const handleScheduleNext = () => {
    if (!routine.trim()) return;
    tapMedium();
    animateTransition(() => setStep(3));
  };

  // Step 3 — Stress
  const handleStress = async (option) => {
    tapMedium();
    setStress(option.value);
    if (skipSleepEnergy) {
      // HealthKit covers sleep + energy. Go straight to generation with derived values.
      await runPlanGeneration({
        stressValue: option.value,
        sleepValue: healthDerived.sleepQuality,
        energyValue: healthDerived.energy,
      });
      return;
    }
    animateTransition(() => setStep(4));
  };

  // Step 4 — Sleep
  const handleSleep = (option) => {
    tapMedium();
    setSleep(option.value);
    animateTransition(() => setStep(5));
  };

  // Step 5 — Energy → triggers plan generation
  const handleEnergy = async (option) => {
    tapMedium();
    await runPlanGeneration({
      stressValue: stress,
      sleepValue: sleep,
      energyValue: option.value,
    });
  };

  const runPlanGeneration = async ({ stressValue, sleepValue, energyValue }) => {
    setError('');
    setLoading(true);

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), 50000);
    });

    try {
      await saveProfileWithoutNav({ goal, routine: routine.trim() });
      await Promise.race([
        generatePlan({ stress: stressValue, sleepQuality: sleepValue, energy: energyValue }),
        timeout,
      ]);
      clearTimeout(timeoutId);
      activateProfile();
    } catch (err) {
      clearTimeout(timeoutId);
      // Paywall during onboarding is an edge case (user must have re-signed
      // up after exhausting the trial on a prior account). Activate the
      // profile so they at least land on the app and can see Paywall.
      if (err?.code === 'PAYWALL_REQUIRED') {
        activateProfile();
        return;
      }
      if (!mountedRef.current) return;
      if (err.message === 'TIMEOUT') setError('Iris is taking longer than usual. Tap an option to try again.');
      else if (err?.code === 'NETWORK_ERROR') setError('Check your internet connection.');
      else setError('Something went wrong. Tap an option to try again.');
      setStep(skipSleepEnergy ? 3 : 5);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    if (step === 1) animateTransition(() => setStep(0));
    else if (step === 2) animateTransition(() => setStep(1));
    else if (step === 3) animateTransition(() => setStep(2));
    else if (step === 4) animateTransition(() => setStep(3));
    else if (step === 5) animateTransition(() => setStep(4));
  };

  // Progress bar math
  const totalSteps = skipSleepEnergy ? 4 : 6;
  // Visible step index for progress (Health is step 0 → progress 1, etc.)
  const visibleIndex = step + 1;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={s.container}>

          <View style={s.brandRow}>
            <Text style={s.logo}>LiveNew</Text>
            <IrisSignature />
          </View>

          {!loading && (
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${(visibleIndex / totalSteps) * 100}%` }]} />
            </View>
          )}

          {loading ? (
            <LoadingAnimation loadingStyles={loadingStyles} />
          ) : (
            <Animated.View style={[s.body, { opacity: fadeAnim }]}>
              {step > 0 && (
                <Pressable style={s.backBtn} onPress={handleBack} hitSlop={8}>
                  <Text style={s.backText}>{'←'}  Back</Text>
                </Pressable>
              )}

              {/* Step 0 — Apple Health */}
              {step === 0 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>Connect Apple Health</Text>
                  <Text style={s.healthSub}>
                    I read your real sleep, resting heart rate, and HRV from Apple Health. The plan I give you back is calibrated to your actual biometrics — not guesses.
                  </Text>
                  <View style={s.healthBullets}>
                    <Text style={s.healthBullet}>•  Real cortisol-aware insights from your data</Text>
                    <Text style={s.healthBullet}>•  Sleep + energy auto-filled — fewer questions to answer</Text>
                    <Text style={s.healthBullet}>•  Read-only. Nothing is written back.</Text>
                  </View>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <Pressable
                    style={({ pressed }) => [s.healthPrimary, pressed && { opacity: 0.9 }, connectingHealth && { opacity: 0.6 }]}
                    onPress={handleConnectHealth}
                    disabled={connectingHealth}
                  >
                    <Text style={s.healthPrimaryText}>
                      {connectingHealth ? 'Connecting…' : 'Connect Apple Health'}
                    </Text>
                  </Pressable>
                  <Pressable style={s.healthSecondary} onPress={handleSkipHealth} disabled={connectingHealth}>
                    <Text style={s.healthSecondaryText}>Not now</Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* Step 1 — Goal (chip picker) */}
              {step === 1 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>What actually matters?</Text>
                  <Text style={s.sub}>Pick one. I'll bend the plan toward it.</Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <View style={s.chipGrid}>
                    {GOAL_OPTIONS.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() => handleGoal(option)}
                        style={({ pressed }) => [s.chip, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={s.chipText}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Step 2 — Schedule (free text) */}
              {step === 2 && (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>What does a typical day look like?</Text>
                  <Text style={s.sub}>
                    Wake time, work hours, gym, when you eat, when you sleep. Two lines is plenty. The more specific you are, the better I can tune the plan around your day.
                  </Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <TextInput
                    style={s.routineInput}
                    placeholder={"e.g. Wake 6:30am. Work from home 9–5. Gym at 6pm. Dinner 7. In bed by 11."}
                    placeholderTextColor={colors.dim}
                    value={routine}
                    onChangeText={setRoutine}
                    multiline
                    autoFocus
                    textAlignVertical="top"
                    maxLength={400}
                  />
                  <Pressable
                    style={({ pressed }) => [s.primary, (!routine.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                    onPress={handleScheduleNext}
                    disabled={!routine.trim()}
                  >
                    <Text style={s.primaryText}>Continue</Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* Step 3 — Stress (always) */}
              {step === 3 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>How are you feeling right now?</Text>
                  {skipSleepEnergy && healthDerived.summary ? (
                    <Text style={s.healthSummary}>
                      I already read {healthDerived.summary} Just your stress now.
                    </Text>
                  ) : null}
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <View style={s.list}>
                    {STRESS_OPTIONS.map((option) => (
                      <PressRow key={option.value} onPress={() => handleStress(option)} s={s}>
                        <View style={s.optionContent}>
                          <Text style={s.optionLabel}>{option.label}</Text>
                          {option.sub && <Text style={s.optionSub}>{option.sub}</Text>}
                        </View>
                        <Text style={s.optionChevron}>{'›'}</Text>
                      </PressRow>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Step 4 — Sleep (only if HealthKit didn't cover it) */}
              {step === 4 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>How did you sleep?</Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <View style={s.list}>
                    {SLEEP_OPTIONS.map((option) => (
                      <PressRow key={option.value} onPress={() => handleSleep(option)} s={s}>
                        <View style={s.optionContent}>
                          <Text style={s.optionLabel}>{option.label}</Text>
                          {option.sub && <Text style={s.optionSub}>{option.sub}</Text>}
                        </View>
                        <Text style={s.optionChevron}>{'›'}</Text>
                      </PressRow>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* Step 5 — Energy (only if HealthKit didn't cover it) */}
              {step === 5 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                  <Text style={s.heading}>Your energy right now?</Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <View style={s.list}>
                    {ENERGY_OPTIONS.map((option) => (
                      <PressRow key={option.value} onPress={() => handleEnergy(option)} s={s}>
                        <View style={s.optionContent}>
                          <Text style={s.optionLabel}>{option.label}</Text>
                          {option.sub && <Text style={s.optionSub}>{option.sub}</Text>}
                        </View>
                        <Text style={s.optionChevron}>{'›'}</Text>
                      </PressRow>
                    ))}
                  </View>
                </ScrollView>
              )}
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },

    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 22,
    },
    logo: {
      fontFamily: fonts.displaySemibold,
      fontSize: 18,
      color: colors.gold,
      letterSpacing: 1.6,
    },

    progressTrack: {
      height: 2,
      backgroundColor: colors.line,
      borderRadius: 1,
      marginBottom: 28,
      overflow: 'hidden',
    },
    progressFill: { height: 2, backgroundColor: colors.gold },

    body: { flex: 1 },

    backBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 12 },
    backText: { color: colors.muted, fontFamily: fonts.body, fontSize: 14, letterSpacing: 0.2 },

    heading: {
      fontFamily: fonts.displayBold,
      fontSize: 28,
      color: colors.text,
      marginBottom: 8,
      letterSpacing: -0.2,
      lineHeight: 34,
    },
    sub: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.muted,
      marginBottom: 22,
      lineHeight: 22,
    },
    healthSummary: {
      fontFamily: fonts.italic,
      fontSize: 14,
      color: colors.gold,
      lineHeight: 20,
      letterSpacing: 0.1,
      marginBottom: 20,
      marginTop: -4,
    },

    error: {
      color: colors.error,
      fontFamily: fonts.body,
      fontSize: 14,
      marginBottom: 16,
      fontStyle: 'italic',
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
      letterSpacing: 0.1,
    },
    optionChevron: {
      fontFamily: fonts.body,
      fontSize: 22,
      color: colors.gold,
      marginLeft: 8,
      lineHeight: 22,
    },

    // Goal chip grid
    chipGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 8,
    },
    chip: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 999,
      paddingVertical: 14,
      paddingHorizontal: 20,
    },
    chipText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 15,
      color: colors.text,
      letterSpacing: 0.1,
    },

    // Routine text input
    routineInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingVertical: 16,
      fontFamily: fonts.body,
      fontSize: 16,
      color: colors.text,
      lineHeight: 24,
      minHeight: 140,
      marginBottom: 16,
    },

    // Primary CTA
    primary: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    primaryText: {
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
      letterSpacing: 0.2,
    },

    // Apple Health step
    healthSub: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 23,
      marginBottom: 22,
      letterSpacing: 0.1,
    },
    healthBullets: {
      gap: 10,
      marginBottom: 32,
    },
    healthBullet: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.text,
      lineHeight: 22,
      letterSpacing: 0.1,
    },
    healthPrimary: {
      backgroundColor: colors.gold,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 10,
    },
    healthPrimaryText: {
      color: '#1a1612',
      fontFamily: fonts.displaySemibold,
      fontSize: 17,
      letterSpacing: 0.2,
    },
    healthSecondary: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    healthSecondaryText: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.muted,
      letterSpacing: 0.2,
    },
  });
}

function makeLoadingStyles(colors, fonts) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 24, paddingBottom: 80 },
    dotsRow: { flexDirection: 'row', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
    message: {
      fontFamily: fonts.italic,
      color: colors.muted,
      fontSize: 16,
    },
  });
}
