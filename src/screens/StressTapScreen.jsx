import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';

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

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => {
        if (prev < messages.length - 1) return prev + 1;
        return prev;
      });
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

export default function StressTapScreen({ navigation }) {
  const [step, setStep] = useState(1);   // 1=stress, 2=sleep, 3=energy
  const [stress, setStress] = useState(null);
  const [sleep, setSleep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fadeAnim = useState(new Animated.Value(1))[0];

  const generatePlan = useAuthStore(s => s.generatePlan);

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
      if (err.message === 'TIMEOUT') {
        setError('Taking longer than usual. Tap to try again.');
      } else if (err.message === 'AUTH_EXPIRED') {
        setError('Session expired. Please log in again.');
      } else if (err.code === 'NETWORK_ERROR') {
        setError('Check your internet connection.');
      } else {
        setError('Something went wrong. Tap to try again.');
      }
      // Keep selections — user can retry from energy step without re-answering
      setStep(3);
      setLoading(false);
    }
  };

  const handleBack = () => {
    tapMedium();
    animateTransition(() => {
      if (step === 3) { setStep(2); }
      else if (step === 2) { setStep(1); setStress(null); }
    });
  };

  const stepLabels = { 1: 'How are you feeling?', 2: 'How did you sleep?', 3: 'Energy right now?' };
  const options = step === 1 ? STRESS_OPTIONS : step === 2 ? SLEEP_OPTIONS : ENERGY_OPTIONS;
  const handler = step === 1 ? handleStress : step === 2 ? handleSleep : handleEnergy;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.topLabel}>Daily check-in</Text>

        {/* Step indicator — hidden during loading */}
        {!loading && (
          <View style={s.stepRow}>
            {[1, 2, 3].map(i => (
              <View key={i} style={[s.stepDot, i <= step && s.stepDotActive]} />
            ))}
          </View>
        )}

        {error ? (
          <Text style={s.error}>{error}</Text>
        ) : null}

        {loading ? (
          <LoadingAnimation />
        ) : (
          <Animated.View style={{ opacity: fadeAnim }}>
            {step > 1 && (
              <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
                <Text style={s.backText}>{'\u2190'} Back</Text>
              </TouchableOpacity>
            )}

            <Text style={s.heading}>{stepLabels[step]}</Text>

            <View style={step === 1 ? s.grid : s.row}>
              {options.map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    step === 1 ? s.option : s.optionSmall,
                  ]}
                  onPress={() => handler(option)}
                  activeOpacity={0.7}
                >
                  <Text style={s.emoji}>{option.emoji}</Text>
                  <Text style={s.optionLabel}>{option.label}</Text>
                </TouchableOpacity>
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
  container: { flex: 1, justifyContent: 'flex-start', padding: 24, paddingTop: 60 },

  topLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.dim,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 24,
  },

  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
  },
  stepDotActive: {
    backgroundColor: colors.gold,
  },

  heading: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 32,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },

  option: {
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

  emoji: {
    fontSize: 28,
  },

  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },

  error: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },

  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  backText: {
    color: colors.muted,
    fontSize: 15,
  },
});

const loadingStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 20,
    paddingTop: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.gold,
  },
  message: {
    color: colors.muted,
    fontSize: 16,
  },
});
