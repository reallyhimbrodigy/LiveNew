import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

const STRESS_OPTIONS = [
  { label: 'Good', value: 'good', emoji: '😌' },
  { label: 'Okay', value: 'okay', emoji: '😐' },
  { label: 'Stressed', value: 'stressed', emoji: '😰' },
  { label: 'Overwhelmed', value: 'overwhelmed', emoji: '🤯' },
];

export default function StressTapScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const generatePlan = useAuthStore(s => s.generatePlan);

  const handleTap = async (option) => {
    setSelected(option.value);
    setError('');
    setLoading(true);

    try {
      await generatePlan(option.value);
      navigation.replace('TodayMain');
    } catch (err) {
      setError('Servers are busy. Tap again.');
      setSelected(null);
    }

    setLoading(false);
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
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={s.loadingText}>Building your day plan...</Text>
          </View>
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

  loadingWrap: {
    alignItems: 'center',
    gap: 16,
  },

  loadingText: {
    color: colors.muted,
    fontSize: 16,
  },

  error: {
    color: colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});
