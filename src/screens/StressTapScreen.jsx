import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapMedium } from '../haptics';

const STRESS_OPTIONS = [
  { label: 'Good', value: 'good', emoji: '😌' },
  { label: 'Okay', value: 'okay', emoji: '😐' },
  { label: 'Stressed', value: 'stressed', emoji: '😰' },
  { label: 'Overwhelmed', value: 'overwhelmed', emoji: '🤯' },
];

function LoadingAnimation() {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = [
    'Reading your stress level...',
    'Analyzing your routine...',
    'Building your sessions...',
    'Selecting your meals...',
    'Finalizing your plan...',
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => {
        if (prev < messages.length - 1) return prev + 1;
        return prev;
      });
    }, 2500);
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
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const generatePlan = useAuthStore(s => s.generatePlan);

  const handleTap = async (option) => {
    tapMedium();
    setSelected(option.value);
    setError('');
    setLoading(true);

    // Timeout after 45 seconds
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 45000)
    );

    try {
      const result = await Promise.race([
        generatePlan(option.value),
        timeout,
      ]);
      navigation.replace('TodayMain');
    } catch (err) {
      if (err.message === 'TIMEOUT') {
        setError('Taking longer than usual. Tap to try again.');
      } else if (err.message === 'AUTH_EXPIRED') {
        // Token expired — will be caught by auth store
        setError('Session expired. Please log in again.');
      } else {
        setError('Something went wrong. Tap to try again.');
      }
      setSelected(null);
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        <Text style={s.logo}>LiveNew</Text>

        <Text style={s.heading}>How are you feeling?</Text>

        {error ? (
          <Text style={s.error}>{error}</Text>
        ) : null}

        {loading ? (
          <LoadingAnimation />
        ) : (
          <View style={s.grid}>
            {STRESS_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  s.option,
                  selected === option.value && s.optionSelected,
                ]}
                onPress={() => handleTap(option)}
                activeOpacity={0.7}
              >
                <Text style={s.emoji}>{option.emoji}</Text>
                <Text style={[
                  s.optionLabel,
                  selected === option.value && s.optionLabelSelected,
                ]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
    marginBottom: 48,
    letterSpacing: 1,
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

  optionSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldDim,
  },

  emoji: {
    fontSize: 32,
  },

  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },

  optionLabelSelected: {
    color: colors.gold,
  },

  error: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
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
