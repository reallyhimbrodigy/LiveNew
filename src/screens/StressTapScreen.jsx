import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';
import IrisSignature from '../components/IrisSignature';

const STRESS_OPTIONS = [
  { label: 'Good', value: 'good', sub: 'calm, steady' },
  { label: 'Okay', value: 'okay', sub: 'a little tense' },
  { label: 'Stressed', value: 'stressed', sub: 'on edge' },
  { label: 'Overwhelmed', value: 'overwhelmed', sub: 'too much at once' },
];

const SLEEP_OPTIONS = [
  { label: 'Great', value: 'great', sub: 'rested' },
  { label: 'OK', value: 'okay', sub: 'enough to function' },
  { label: 'Rough', value: 'rough', sub: 'tired before today started' },
];

const ENERGY_OPTIONS = [
  { label: 'High', value: 'high', sub: 'sharp and ready' },
  { label: 'Medium', value: 'medium', sub: 'steady' },
  { label: 'Low', value: 'low', sub: 'dragging' },
];

function PressRow({ onPress, children, rowStyle }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={() => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 60, bounciness: 0 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 60, bounciness: 4 }).start()}
        onPress={onPress}
        style={rowStyle}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function LoadingAnimation({ loadingStyles }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = [
    'Reading your signals…',
    'Mapping your day…',
    'Finding what matters…',
    'Building your plan…',
  ];

  React.useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => (prev < messages.length - 1 ? prev + 1 : prev));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={loadingStyles.wrap}>
      <View style={loadingStyles.dotsRow}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[loadingStyles.dot, { opacity: messageIndex % 3 === i ? 1 : 0.2 }]} />
        ))}
      </View>
      <Text style={loadingStyles.message}>{messages[messageIndex]}</Text>
    </View>
  );
}

export default function StressTapScreen({ navigation }) {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const loadingStyles = useMemo(() => makeLoadingStyles(colors, fonts), [colors, fonts]);

  const healthPermission = useAuthStore(s => s.healthPermission);
  const connectHealth = useAuthStore(s => s.connectHealth);
  // If the user has never been asked, surface the HealthKit step FIRST,
  // before any check-in input. Production apps ask for system permissions
  // before they generate personalized content, not after.
  const showHealthStep = healthPermission !== 'granted' && healthPermission !== 'denied';
  const [step, setStep] = useState(showHealthStep ? 0 : 1);
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connectingHealth, setConnectingHealth] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const generatePlan = useAuthStore(s => s.generatePlan);
  const skipToday = useAuthStore(s => s.skipToday);

  // Total steps shown in the progress bar — 3 if no health step needed, 4 otherwise.
  const totalSteps = showHealthStep ? 4 : 3;
  const currentStepIndex = showHealthStep ? step + 1 : step;

  const animateTransition = (callback) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      callback();
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const handleStress = (option) => {
    tapMedium();
    setStress(option.value);
    animateTransition(() => setStep(2));
  };

  const handleSleep = (option) => {
    tapMedium();
    setSleep(option.value);
    animateTransition(() => setStep(3));
  };

  const handleEnergy = async (option) => {
    tapMedium();
    setError('');
    setLoading(true);

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), 50000);
    });

    try {
      await Promise.race([
        generatePlan({ stress, sleepQuality: sleep, energy: option.value }),
        timeout,
      ]);
      clearTimeout(timeoutId);
      navigation.replace('TodayMain');
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message === 'TIMEOUT') setError('Taking longer than usual. Tap to try again.');
      else if (err.message === 'AUTH_EXPIRED') setError('Session expired. Please log in again.');
      else if (err.code === 'NETWORK_ERROR') setError('Check your internet connection.');
      else setError('Something went wrong. Tap to try again.');
      setStep(3);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    animateTransition(() => {
      if (step === 3) setStep(2);
      else if (step === 2) { setStep(1); setStress(null); }
      else if (step === 1 && showHealthStep) setStep(0);
    });
  };

  const handleSkip = async () => {
    tapMedium();
    await skipToday();
    navigation.replace('TodayMain');
  };

  // Step 0 — Apple Health permission.
  const handleConnectHealth = async () => {
    if (connectingHealth) return;
    tapMedium();
    setConnectingHealth(true);
    const result = await connectHealth();
    setConnectingHealth(false);
    if (!result.ok && result.error) {
      Alert.alert('Couldn\'t connect', result.error);
      return;
    }
    // Whether granted or not — proceed to the actual check-in. The screen
    // won't re-ask within this session.
    animateTransition(() => setStep(1));
  };
  const handleSkipHealth = () => {
    tapMedium();
    // Mark denied so we don't re-prompt next check-in. User can connect from Account.
    useAuthStore.setState({ healthPermission: 'denied' });
    require('../healthkit').setHealthPermissionStatus('denied').catch(() => {});
    animateTransition(() => setStep(1));
  };

  const stepHeading = {
    1: 'How are you feeling?',
    2: 'How did you sleep?',
    3: 'Energy right now?',
  };
  const options = step === 1 ? STRESS_OPTIONS
    : step === 2 ? SLEEP_OPTIONS
    : ENERGY_OPTIONS;
  const handler = step === 1 ? handleStress
    : step === 2 ? handleSleep
    : handleEnergy;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.container}>

        {!loading && (
          <>
            <View style={s.brandRow}>
              <IrisSignature />
            </View>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${(currentStepIndex / totalSteps) * 100}%` }]} />
            </View>
          </>
        )}

        {loading ? (
          <LoadingAnimation loadingStyles={loadingStyles} />
        ) : step === 0 ? (
          // STEP 0 — Apple Health permission. Pre-plan, system-style.
          <Animated.View style={[s.body, { opacity: fadeAnim }]}>
            <Text style={s.heading}>Connect Apple Health</Text>
            <Text style={s.healthSub}>
              We read your actual sleep, resting heart rate, and HRV from Apple Health. The plan you get back is calibrated to your real biometrics — not guesses.
            </Text>
            <View style={s.healthBullets}>
              <Text style={s.healthBullet}>•  Real cortisol-aware insights from your data</Text>
              <Text style={s.healthBullet}>•  Score reflects actual recovery, not a self-rating</Text>
              <Text style={s.healthBullet}>•  Read-only. Nothing is written back. Nothing leaves your phone.</Text>
            </View>
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
          </Animated.View>
        ) : (
          <Animated.View style={[s.body, { opacity: fadeAnim }]}>
            {step > 1 && (
              <Pressable style={s.backBtn} onPress={handleBack} hitSlop={8}>
                <Text style={s.backText}>{'←'}  Back</Text>
              </Pressable>
            )}

            <Text style={s.heading}>{stepHeading[step]}</Text>

            {error ? <Text style={s.error}>{error}</Text> : null}

            <View style={s.list}>
              {options.map(option => (
                <PressRow key={option.value} onPress={() => handler(option)} rowStyle={s.optionRow}>
                  <View style={s.optionContent}>
                    <Text style={s.optionLabel}>{option.label}</Text>
                    {option.sub && <Text style={s.optionSub}>{option.sub}</Text>}
                  </View>
                  <Text style={s.optionChevron}>{'›'}</Text>
                </PressRow>
              ))}
            </View>

            {step === 1 && (
              <Pressable style={s.skipLink} onPress={handleSkip} hitSlop={8}>
                <Text style={s.skipText}>Just browsing — skip for now</Text>
              </Pressable>
            )}
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },

    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 18,
    },
    progressTrack: {
      height: 2,
      backgroundColor: colors.line,
      borderRadius: 1,
      marginBottom: 48,
      overflow: 'hidden',
    },
    progressFill: { height: 2, backgroundColor: colors.gold },

    body: { flex: 1 },

    backBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 12 },
    backText: { color: colors.muted, fontFamily: fonts.body, fontSize: 14, letterSpacing: 0.2 },

    heading: {
      fontFamily: fonts.display,
      fontSize: 30,
      color: colors.text,
      textAlign: 'left',
      marginBottom: 28,
      letterSpacing: 0.2,
      lineHeight: 36,
    },

    error: {
      color: colors.error,
      fontFamily: fonts.body,
      fontSize: 14,
      marginBottom: 16,
      fontStyle: 'italic',
    },

    list: { gap: 10 },

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
      fontFamily: fonts.displayItalic,
      fontSize: 13,
      color: colors.muted,
      marginTop: 3,
      letterSpacing: 0.1,
    },
    optionChevron: {
      fontFamily: fonts.body,
      fontSize: 22,
      color: colors.gold,
      fontWeight: '300',
      marginLeft: 8,
      lineHeight: 22,
    },

    skipLink: {
      alignSelf: 'center',
      marginTop: 32,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    skipText: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, letterSpacing: 0.2 },

    // Step 0 — Apple Health permission
    healthSub: {
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.muted,
      lineHeight: 23,
      marginBottom: 24,
      letterSpacing: 0.1,
    },
    healthBullets: {
      gap: 10,
      marginBottom: 36,
    },
    healthBullet: {
      fontFamily: fonts.display,
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
      fontFamily: fonts.displayBold,
      fontSize: 16,
      letterSpacing: 0.3,
    },
    healthSecondary: {
      paddingVertical: 14,
      alignItems: 'center',
    },
    healthSecondaryText: {
      color: colors.muted,
      fontFamily: fonts.body,
      fontSize: 14,
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
      fontFamily: fonts.displayItalic,
      color: colors.muted,
      fontSize: 16,
    },
  });
}
