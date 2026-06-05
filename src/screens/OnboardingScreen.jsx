import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';
import IrisSignature from '../components/IrisSignature';
import { deriveFromHealth, canSkipSleepAndEnergy } from '../utils/healthInference';
import { isSleepWindow } from '../utils/localDate';

// Onboarding step machine:
//   0 — Apple Health (always asked, FIRST)
//   1 — Schedule (free-text typed input — needed for real personalization)
//   2 — Stress (always asked, subjective)
//   3 — Sleep  (SKIPPED if HealthKit granted with data)
//   4 — Energy (SKIPPED if HealthKit granted with data)
//
// Goal removed: cortisol regulation is the universal lever — Iris targets the
// full benefit spectrum based on daily state, not a stated goal.
//
// Total steps shown in the progress bar adapts: 3 for HealthKit-granted users,
// 5 for users who decline HealthKit.

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
  const logout = useAuthStore(z => z.logout);

  const handleSignOut = () => {
    tapMedium();
    Alert.alert(
      'Sign out?',
      "You can come back any time. Your account stays put.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  // Derived: skip sleep + energy questions when HealthKit gives us the data.
  const healthDerived = useMemo(() => deriveFromHealth(healthSnapshot), [healthSnapshot]);
  const skipSleepEnergy = canSkipSleepAndEnergy(healthSnapshot);

  const [step, setStep] = useState(0); // 0=Health, 1=Schedule, 2=Stress, 3=Sleep, 4=Energy
  const [routine, setRoutine] = useState('');
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connectingHealth, setConnectingHealth] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);
  const routineInputRef = useRef(null);

  // Deferred focus on the routine input — replaces autoFocus, which raced
  // with KeyboardAvoidingView's layout calculation on iOS and could leave
  // step 1 rendered blank (content pushed off-screen by the keyboard before
  // the view finished measuring). A 350ms delay lets the layout settle and
  // the fade-in finish before the keyboard slides up.
  useEffect(() => {
    if (step !== 1) return;
    const t = setTimeout(() => {
      if (mountedRef.current) routineInputRef.current?.focus();
    }, 350);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Bulletproof fade-in on step change. The PRIOR implementation chained
  // fade-out → setState → fade-in inside a single Animated.timing completion
  // callback, which left users stranded on a permanently-invisible (opacity:0)
  // screen if anything interrupted the chain mid-flight (re-render, async
  // error, fast nav). This effect resets opacity to 0 and fades to 1
  // declaratively on every step change — no callback chain to break.
  useEffect(() => {
    fadeAnim.setValue(0);
    const anim = Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [step]);

  // Step 0 — Apple Health. Wrapped in try/catch because connectHealth can
  // throw (denied permission threw an unhandled error in earlier builds,
  // stranding users on step 0 with the spinner stuck). Advancing to step 1
  // regardless of the result matches the StressTap behavior — denial is
  // not a dead-end, we just lose the auto-fill of sleep/energy questions.
  const handleConnectHealth = async () => {
    if (connectingHealth) return;
    tapMedium();
    setConnectingHealth(true);
    try {
      await connectHealth();
    } catch (err) {
      console.warn('[onboarding] connectHealth failed', err?.message);
    } finally {
      if (mountedRef.current) {
        setConnectingHealth(false);
        setStep(1);
      }
    }
  };
  // Step 1 — Schedule
  const handleScheduleNext = () => {
    if (!routine.trim()) return;
    tapMedium();
    setStep(2);
  };

  // Step 2 — Stress
  const handleStress = async (option) => {
    tapMedium();
    setStress(option.value);
    if (skipSleepEnergy) {
      await runPlanGeneration({
        stressValue: option.value,
        sleepValue: healthDerived.sleepQuality,
        energyValue: healthDerived.energy,
      });
      return;
    }
    setStep(3);
  };

  // Step 3 — Sleep
  const handleSleep = (option) => {
    tapMedium();
    setSleep(option.value);
    setStep(4);
  };

  // Step 4 — Energy → triggers plan generation
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

    // Sleep-window short-circuit: a new user finishing onboarding at 2am
    // shouldn't get a stale plan whose zones are 80% in the past — that
    // first impression reads as broken. Save the profile, activate it
    // (so RootNavigator routes to MainTabs), and skip plan generation
    // entirely. TodayScreen will render the sleep card with the
    // first-time welcome treatment, and the user's actual first plan
    // gets built fresh when they open the app in the morning.
    if (isSleepWindow()) {
      try {
        await saveProfileWithoutNav({ routine: routine.trim() });
        activateProfile();
      } catch (err) {
        if (!mountedRef.current) return;
        setError("Couldn't save your profile. Try again in a moment.");
        setLoading(false);
      }
      return;
    }

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), 50000);
    });

    try {
      await saveProfileWithoutNav({ routine: routine.trim() });
      await Promise.race([
        generatePlan({ stress: stressValue, sleepQuality: sleepValue, energy: energyValue }),
        timeout,
      ]);
      clearTimeout(timeoutId);
      activateProfile();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err?.code === 'PAYWALL_REQUIRED') {
        activateProfile();
        return;
      }
      // Sleep-window error from authStore (defense in depth — UI already
      // gated above, but if anything sneaks through, treat it as a clean
      // "no plan, go to Today" exit rather than an error.
      if (err?.code === 'SLEEP_WINDOW') {
        activateProfile();
        return;
      }
      if (!mountedRef.current) return;
      if (err.message === 'TIMEOUT') setError('Iris is taking longer than usual. Tap an option to try again.');
      else if (err?.code === 'NETWORK_ERROR') setError('Check your internet connection.');
      else setError('Something went wrong. Tap an option to try again.');
      setStep(skipSleepEnergy ? 2 : 4);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    if (step === 1) setStep(0);
    else if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  };

  // Progress bar math
  const totalSteps = skipSleepEnergy ? 3 : 5;
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <IrisSignature />
              <Pressable onPress={handleSignOut} hitSlop={8}>
                <Text style={s.signOutLink}>Sign out</Text>
              </Pressable>
            </View>
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
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
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
                  {/* Single CTA. The iOS permission sheet that follows is
                      what handles the deny path — Apple rejects custom
                      "Not now" screens that bypass the system dialog
                      (guideline 5.1.1(iv)). Tapping Continue triggers the
                      native sheet; if the user denies there, we still
                      advance to the next step. */}
                  <Pressable
                    style={({ pressed }) => [s.healthPrimary, pressed && { opacity: 0.9 }, connectingHealth && { opacity: 0.6 }]}
                    onPress={handleConnectHealth}
                    disabled={connectingHealth}
                  >
                    <Text style={s.healthPrimaryText}>
                      {connectingHealth ? 'Connecting…' : 'Continue'}
                    </Text>
                  </Pressable>
                  <Text style={s.healthFootnote}>
                    You'll be asked which data types to share. You can change this any time in Settings → Privacy → Health.
                  </Text>
                </ScrollView>
              )}

              {/* Step 1 — Schedule (free text). This is the single
                  load-bearing step of onboarding — the routine string is
                  injected into every plan-generation prompt Iris runs, so
                  the precision of the user's answer here directly drives
                  the precision of every protocol they'll ever see. The
                  eyebrow + Iris-voiced footer below exist to make that
                  weight visible so users don't dash off two vague lines. */}
              {step === 1 && (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
                  <Text style={s.eyebrow}>THE MOST IMPORTANT STEP</Text>
                  <Text style={s.heading}>What does a typical day look like?</Text>
                  <Text style={s.sub}>
                    Wake time, work hours, gym, when you eat, when you sleep — and anything else that shapes your day. The more you tell Iris, the more precisely she can shape your plan. Don't hold back.
                  </Text>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <TextInput
                    ref={routineInputRef}
                    style={s.routineInput}
                    placeholder={"e.g. Wake 6:30am. Work from home 9–5. Gym at 6pm. Dinner 7. In bed by 11."}
                    placeholderTextColor={colors.dim}
                    value={routine}
                    onChangeText={setRoutine}
                    multiline
                    textAlignVertical="top"
                    maxLength={400}
                  />
                  <Text style={s.irisHint}>
                    Of every question I'll ask, this one shapes your plan the most. Take your time.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [s.primary, (!routine.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                    onPress={handleScheduleNext}
                    disabled={!routine.trim()}
                  >
                    <Text style={s.primaryText}>Continue</Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* Step 2 — Stress (always) */}
              {step === 2 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
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

              {/* Step 3 — Sleep (only if HealthKit didn't cover it) */}
              {step === 3 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
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

              {/* Step 4 — Energy (only if HealthKit didn't cover it) */}
              {step === 4 && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
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

    signOutLink: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 0.3,
      textDecorationLine: 'underline',
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

    // Small gold eyebrow above headings on weight-bearing steps (currently
    // just step 1 — schedule). Visually telegraphs "this matters more"
    // without making the rest of onboarding feel less important.
    eyebrow: {
      fontFamily: fonts.displaySemibold,
      fontSize: 11,
      color: colors.gold,
      letterSpacing: 2,
      marginBottom: 12,
      textTransform: 'uppercase',
    },
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
    // Iris-voiced reinforcement after the routine input. Italic gold so it
    // reads as Iris speaking directly, not generic helper text. The hint
    // catches users right before they tap Continue, giving them one last
    // nudge to add detail rather than dash off two lines.
    irisHint: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.gold,
      letterSpacing: 0.2,
      lineHeight: 19,
      marginTop: 14,
      marginBottom: 16,
      paddingLeft: 12,
      borderLeftWidth: 2,
      borderLeftColor: colors.gold,
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
    healthFootnote: {
      fontFamily: fonts.body,
      fontSize: 12,
      color: colors.muted,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: 14,
      paddingHorizontal: 4,
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
