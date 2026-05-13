import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';
import IrisSignature from '../components/IrisSignature';

// Goal is no longer asked in onboarding. Defaults to "feel better generally"
// and can be set/changed any time in Account → Your profile → My goal.
const DEFAULT_GOAL = 'I just want to feel better overall';

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

export default function OnboardingScreen() {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const loadingStyles = useMemo(() => makeLoadingStyles(colors, fonts), [colors, fonts]);

  const [step, setStep] = useState(1); // 1=stress, 2=sleep, 3=energy
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const saveProfileWithoutNav = useAuthStore(z => z.saveProfileWithoutNav);
  const generatePlan = useAuthStore(z => z.generatePlan);
  const activateProfile = useAuthStore(z => z.activateProfile);

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
      await saveProfileWithoutNav({ goal: DEFAULT_GOAL });
      await Promise.race([
        generatePlan({ stress, sleepQuality: sleep, energy: option.value }),
        timeout,
      ]);
      clearTimeout(timeoutId);
      activateProfile();
    } catch (err) {
      clearTimeout(timeoutId);
      if (!mountedRef.current) return;
      if (err.message === 'TIMEOUT') setError('Iris is taking longer than usual. Tap an option to try again.');
      else if (err?.code === 'NETWORK_ERROR') setError('Check your internet connection.');
      else setError('Something went wrong. Tap an option to try again.');
      setStep(3);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    if (step === 2) { setStress(null); animateTransition(() => setStep(1)); }
    else if (step === 3) { setSleep(null); animateTransition(() => setStep(2)); }
  };

  const totalSteps = 3;

  const stepHeading = {
    1: 'How are you feeling?',
    2: 'How did you sleep?',
    3: 'Your energy right now?',
  };
  const stepSub = {
    1: null,
    2: null,
    3: null,
  };
  const stepOptions = step === 1 ? STRESS_OPTIONS
    : step === 2 ? SLEEP_OPTIONS
    : ENERGY_OPTIONS;
  const stepHandler = step === 1 ? handleStress
    : step === 2 ? handleSleep
    : handleEnergy;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.container}>

        <View style={s.brandRow}>
          <Text style={s.logo}>LiveNew</Text>
          <IrisSignature />
        </View>

        {!loading && (
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
          </View>
        )}

        {loading ? (
          <LoadingAnimation loadingStyles={loadingStyles} />
        ) : (
          <Animated.View style={[s.body, { opacity: fadeAnim }]}>
            {step > 1 && (
              <Pressable style={s.backBtn} onPress={handleBack} hitSlop={8}>
                <Text style={s.backText}>{'←'}  Back</Text>
              </Pressable>
            )}

            <Text style={s.heading}>{stepHeading[step]}</Text>
            {stepSub[step] && <Text style={s.sub}>{stepSub[step]}</Text>}

            {error ? <Text style={s.error}>{error}</Text> : null}

            <View style={s.list}>
              {stepOptions.map(option => (
                <PressRow
                  key={option.value}
                  onPress={() => stepHandler(option)}
                  s={s}
                >
                  <View style={s.optionContent}>
                    <Text style={s.optionLabel}>{option.label}</Text>
                    {option.sub && <Text style={s.optionSub}>{option.sub}</Text>}
                  </View>
                  <Text style={s.optionChevron}>{'›'}</Text>
                </PressRow>
              ))}
            </View>
          </Animated.View>
        )}
      </View>
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
      marginBottom: 32,
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
      marginBottom: 8,
      letterSpacing: 0.2,
      lineHeight: 36,
    },
    sub: {
      fontFamily: fonts.displayItalic,
      fontSize: 15,
      color: colors.muted,
      marginBottom: 24,
      lineHeight: 22,
    },

    error: {
      color: colors.error,
      fontFamily: fonts.body,
      fontSize: 14,
      marginBottom: 16,
      fontStyle: 'italic',
    },

    list: { gap: 10, marginTop: 12 },

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
    optionRowSelected: {
      borderColor: colors.goldBorder,
      backgroundColor: colors.goldSoft,
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
