import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [routine, setRoutine] = useState('');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const saveProfile = useAuthStore(s => s.saveProfile);

  const handleFinish = async () => {
    if (goal.trim().length < 5) return;
    setSaving(true);
    try {
      await saveProfile({ routine: routine.trim(), goal: goal.trim() });
    } catch (err) {
      console.error('[ONBOARD]', err);
    }
    setSaving(false);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          <Text style={s.logo}>LiveNew</Text>

          {step === 1 && (
            <View>
              <Text style={s.heading}>Describe your daily routine</Text>
              <Text style={s.sub}>When do you wake up, what do you do, when do you eat, when do you sleep</Text>

              <TextInput
                style={s.textarea}
                placeholder={"I wake up at 7, work at a desk from 9 to 6, eat lunch around noon, get home at 7, usually in bed by 11 but can't fall asleep until 1am..."}
                placeholderTextColor={colors.dim}
                value={routine}
                onChangeText={setRoutine}
                multiline
                textAlignVertical="top"
                maxLength={1000}
              />

              <TouchableOpacity
                style={[s.btn, routine.trim().length < 10 && s.btnDisabled]}
                onPress={() => { if (routine.trim().length >= 10) setStep(2); }}
                disabled={routine.trim().length < 10}
                activeOpacity={0.8}
              >
                <Text style={s.btnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={s.heading}>What is your goal?</Text>
              <Text style={s.sub}>What do you want to change about how you feel</Text>

              <TextInput
                style={s.textarea}
                placeholder={"I want to sleep through the night and stop feeling anxious all day..."}
                placeholderTextColor={colors.dim}
                value={goal}
                onChangeText={setGoal}
                multiline
                textAlignVertical="top"
                maxLength={500}
              />

              <TouchableOpacity
                style={[s.btn, goal.trim().length < 5 && s.btnDisabled]}
                onPress={handleFinish}
                disabled={goal.trim().length < 5 || saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator color={colors.bg} size="small" />
                ) : (
                  <Text style={s.btnText}>Start LiveNew</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
                <Text style={s.backText}>Back</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },

  logo: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 40,
    letterSpacing: 1,
  },

  heading: {
    fontSize: 22,
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

  textarea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 140,
    lineHeight: 22,
    marginBottom: 20,
  },

  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },

  btnDisabled: {
    opacity: 0.4,
  },

  btnText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
  },

  backBtn: {
    alignItems: 'center',
    marginTop: 16,
    padding: 8,
  },

  backText: {
    color: colors.muted,
    fontSize: 14,
  },
});
