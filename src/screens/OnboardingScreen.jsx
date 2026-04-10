import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';

const GOAL_OPTIONS = [
  { label: 'Sleep better', value: 'I want to sleep through the night and wake up rested', emoji: '\u{1F319}' },
  { label: 'Less anxiety', value: 'I want to stop feeling anxious and overwhelmed all day', emoji: '\u{1F32C}\uFE0F' },
  { label: 'More energy', value: 'I want consistent energy throughout the day without crashing', emoji: '\u26A1' },
  { label: 'Lose weight', value: 'I want to lose weight and stop stress eating', emoji: '\u{1F331}' },
  { label: 'Be calmer', value: 'I want to feel calm and in control of my stress', emoji: '\u{1F9D8}' },
  { label: 'Feel better', value: 'I just want to feel better overall', emoji: '\u2728' },
];

const STRESS_OPTIONS = [
  { label: 'Good', value: 'good', emoji: '\u{1F60C}' },
  { label: 'Okay', value: 'okay', emoji: '\u{1F610}' },
  { label: 'Stressed', value: 'stressed', emoji: '\u{1F630}' },
  { label: 'Overwhelmed', value: 'overwhelmed', emoji: '\u{1F92F}' },
];

const SLEEP_OPTIONS = [
  { label: 'Great', value: 'great', emoji: '\u{1F31F}' },
  { label: 'OK', value: 'okay', emoji: '\u{1F634}' },
  { label: 'Rough', value: 'rough', emoji: '\u{1F62B}' },
];

const ENERGY_OPTIONS = [
  { label: 'High', value: 'high', emoji: '\u26A1' },
  { label: 'Medium', value: 'medium', emoji: '\u{1F44C}' },
  { label: 'Low', value: 'low', emoji: '\u{1F50B}' },
];

function LoadingAnimation() {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = [
    'Reading your signals...',
    'Mapping your day...',
    'Finding what matters...',
    'Building your plan...',
  ];

  React.useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => prev < messages.length - 1 ? prev + 1 : prev);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={loadingStyles.wrap}>
      <View style={loadingStyles.dotsRow}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[
            loadingStyles.dot,
            { opacity: (messageIndex % 3 === i) ? 1 : 0.2 },
          ]} />
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
  const [fadeAnim] = useState(new Animated.Value(1));

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
      if (err.message === 'TIMEOUT') {
        setError('Taking longer than usual. Tap to try again.');
      } else if (err?.code === 'NETWORK_ERROR') {
        setError('Check your internet connection.');
      } else {
        setError('Something went wrong. Tap to try again.');
      }
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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        <Text style={s.logo}>LiveNew</Text>

        {/* Step indicator */}
        <View style={s.stepRow}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <View key={i} style={[s.stepDot, i < step && s.stepDotActive]} />
          ))}
        </View>

        {loading ? (
          <LoadingAnimation />
        ) : (
          <Animated.View style={{ opacity: fadeAnim }}>

            {/* Step 1: Goal */}
            {step === 1 && (
              <View>
                <Text style={s.heading}>What brings you here?</Text>
                <Text style={s.sub}>Pick the one that matters most right now</Text>
                <View style={s.goalGrid}>
                  {GOAL_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={s.goalOption}
                      onPress={() => handleGoal(option)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.goalEmoji}>{option.emoji}</Text>
                      <Text style={s.goalLabel}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Step 2: Stress */}
            {step === 2 && (
              <View>
                <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
                  <Text style={s.backText}>{'\u2190'} Back</Text>
                </TouchableOpacity>
                <Text style={s.heading}>How are you feeling?</Text>
                <View style={s.optionGrid}>
                  {STRESS_OPTIONS.map(option => (
                    <TouchableOpacity key={option.value} style={s.optionLarge} onPress={() => handleStress(option)} activeOpacity={0.7}>
                      <Text style={s.optionEmoji}>{option.emoji}</Text>
                      <Text style={s.optionLabel}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Step 3: Sleep */}
            {step === 3 && (
              <View>
                <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
                  <Text style={s.backText}>{'\u2190'} Back</Text>
                </TouchableOpacity>
                <Text style={s.heading}>How did you sleep?</Text>
                <View style={s.optionRow}>
                  {SLEEP_OPTIONS.map(option => (
                    <TouchableOpacity key={option.value} style={s.optionSmall} onPress={() => handleSleep(option)} activeOpacity={0.7}>
                      <Text style={s.optionEmoji}>{option.emoji}</Text>
                      <Text style={s.optionLabel}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Step 4: Energy */}
            {step === 4 && (
              <View>
                <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
                  <Text style={s.backText}>{'\u2190'} Back</Text>
                </TouchableOpacity>
                <Text style={s.heading}>Energy right now?</Text>
                {error ? <Text style={s.error}>{error}</Text> : null}
                <View style={s.optionRow}>
                  {ENERGY_OPTIONS.map(option => (
                    <TouchableOpacity key={option.value} style={s.optionSmall} onPress={() => handleEnergy(option)} activeOpacity={0.7}>
                      <Text style={s.optionEmoji}>{option.emoji}</Text>
                      <Text style={s.optionLabel}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', padding: 24 },

  logo: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 1,
  },

  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  stepDotActive: { backgroundColor: colors.gold },

  heading: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },

  // Goal selection
  goalGrid: { gap: 10 },
  goalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 14,
  },
  goalEmoji: { fontSize: 22 },
  goalLabel: { fontSize: 16, fontWeight: '500', color: colors.text },

  // Check-in options
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  optionLarge: {
    width: '46%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  optionSmall: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  optionEmoji: { fontSize: 28 },
  optionLabel: { fontSize: 15, fontWeight: '500', color: colors.text },

  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  backText: { color: colors.muted, fontSize: 15 },

  error: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});

const loadingStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20, paddingTop: 20 },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  message: { color: colors.muted, fontSize: 16 },
});
