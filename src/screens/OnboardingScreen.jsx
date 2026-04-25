import React, { useState, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';

const GOAL_OPTIONS = [
  { label: 'Sleep better', value: 'I want to sleep through the night and wake up rested', sub: 'Through the night, wake rested.' },
  { label: 'Less anxiety', value: 'I want to stop feeling anxious and overwhelmed all day', sub: 'Quiet the constant edge.' },
  { label: 'More energy', value: 'I want consistent energy throughout the day without crashing', sub: 'Steady all day, no crashes.' },
  { label: 'Lose weight', value: 'I want to lose weight and stop stress eating', sub: 'Stop the stress-eating cycle.' },
  { label: 'Be calmer', value: 'I want to feel calm and in control of my stress', sub: 'In control, not reactive.' },
  { label: 'Feel better', value: 'I just want to feel better overall', sub: 'Just better, generally.' },
];

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

function PressRow({ onPress, children }) {
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

function LoadingAnimation() {
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
  const [step, setStep] = useState(1); // 1=goal, 2=stress, 3=sleep, 4=energy
  const [goal, setGoal] = useState(null);
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const saveProfileWithoutNav = useAuthStore(s => s.saveProfileWithoutNav);
  const generatePlan = useAuthStore(s => s.generatePlan);
  const activateProfile = useAuthStore(s => s.activateProfile);

  const animateTransition = (callback) => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      callback();
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const handleGoal = (option) => {
    tapMedium();
    setGoal(option.value);
    animateTransition(() => setStep(2));
  };

  const handleStress = (option) => {
    tapMedium();
    setStress(option.value);
    animateTransition(() => setStep(3));
  };

  const handleSleep = (option) => {
    tapMedium();
    setSleep(option.value);
    animateTransition(() => setStep(4));
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
      await saveProfileWithoutNav({ goal });
      await Promise.race([
        generatePlan({ stress, sleepQuality: sleep, energy: option.value }),
        timeout,
      ]);
      clearTimeout(timeoutId);
      activateProfile();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message === 'TIMEOUT') setError('Taking longer than usual. Tap to try again.');
      else if (err?.code === 'NETWORK_ERROR') setError('Check your internet connection.');
      else setError('Something went wrong. Tap to try again.');
      setStep(4);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    if (step === 2) { setGoal(null); animateTransition(() => setStep(1)); }
    else if (step === 3) { setStress(null); animateTransition(() => setStep(2)); }
    else if (step === 4) { setSleep(null); animateTransition(() => setStep(3)); }
  };

  const totalSteps = 4;

  const stepHeading = {
    1: 'What brings you here?',
    2: 'How are you feeling?',
    3: 'How did you sleep?',
    4: 'Energy right now?',
  };
  const stepSub = {
    1: 'Pick the one that matters most right now.',
    2: null,
    3: null,
    4: null,
  };
  const stepOptions = step === 1 ? GOAL_OPTIONS
    : step === 2 ? STRESS_OPTIONS
    : step === 3 ? SLEEP_OPTIONS
    : ENERGY_OPTIONS;
  const stepHandler = step === 1 ? handleGoal
    : step === 2 ? handleStress
    : step === 3 ? handleSleep
    : handleEnergy;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.container}>

        <Text style={s.logo}>LiveNew</Text>

        {!loading && (
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
          </View>
        )}

        {loading ? (
          <LoadingAnimation />
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
                <PressRow key={option.value} onPress={() => stepHandler(option)}>
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },

  logo: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.gold,
    textAlign: 'center',
    marginBottom: 22,
    letterSpacing: 0.6,
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
  backText: { color: colors.muted, fontSize: 14, letterSpacing: 0.2 },

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
  optionContent: { flex: 1, marginRight: 8 },
  optionLabel: {
    fontSize: 17,
    fontWeight: '600',
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
    fontSize: 22,
    color: colors.gold,
    fontWeight: '300',
    marginLeft: 8,
    lineHeight: 22,
  },
});

const loadingStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 24, paddingBottom: 80 },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  message: {
    fontFamily: fonts.displayItalic,
    color: colors.muted,
    fontSize: 16,
  },
});
