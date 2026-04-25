import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, AppState,
  Modal, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapSuccess } from '../haptics';
import { maybePromptReview } from '../reviewPrompt';
import { getLocalDateISO } from '../utils/localDate';
import { api } from '../api';

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function isEvening() {
  return new Date().getHours() >= 19;
}

export default function TodayScreen({ navigation }) {
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const streak = useAuthStore(s => s.streak);
  const completed = useAuthStore(s => s.completed);
  const reflection = useAuthStore(s => s.reflection);
  const profile = useAuthStore(s => s.profile);
  const markDone = useAuthStore(s => s.markDone);
  const submitReflection = useAuthStore(s => s.submitReflection);
  const saveRoutine = useAuthStore(s => s.saveRoutine);

  const [expandedIndex, setExpandedIndex] = useState(null);
  const [showStressRelief, setShowStressRelief] = useState(false);
  const [stressNoted, setStressNoted] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState(getTimeOfDay());

  // Routine upgrade prompt
  const [showRoutinePrompt, setShowRoutinePrompt] = useState(false);
  const [routineText, setRoutineText] = useState('');
  const [savingRoutine, setSavingRoutine] = useState(false);

  const hasRoutine = !!(profile?.routine && profile.routine.length > 5);

  // Check if we need to redirect to check-in
  useEffect(() => {
    const check = async () => {
      const today = getLocalDateISO();
      if (todayPlan && todayDate === today) return;
      try {
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.date === today && cached.contract) {
            useAuthStore.setState({
              todayPlan: cached.contract,
              todayDate: cached.date,
              todayStress: cached.stress,
              todaySleep: cached.sleepQuality,
              todayEnergy: cached.energy,
              completed: cached.completed || {},
              reflection: cached.reflection || null,
            });
            return;
          }
        }
      } catch {}
      navigation.replace('StressTap');
    };
    check();
  }, []);

  // Day change detection
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const today = getLocalDateISO();
        if (todayDate !== today) navigation.replace('StressTap');
        setTimeOfDay(getTimeOfDay());
      }
    });
    return () => sub.remove();
  }, [todayDate]);

  // Update time of day periodically
  useEffect(() => {
    const interval = setInterval(() => setTimeOfDay(getTimeOfDay()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Update time of day and check review on tab focus
  useFocusEffect(
    useCallback(() => {
      setTimeOfDay(getTimeOfDay());
      const items = todayPlan?.plan || [];
      if (items.length > 0 && items.every((_, i) => completed[i])) {
        maybePromptReview();
      }
    }, [completed, todayPlan])
  );

  const planItems = todayPlan?.plan || [];
  const doneCount = planItems.filter((_, i) => completed[i]).length;
  const rightNowText = todayPlan?.rightNow?.[timeOfDay] || null;
  const goalThread = todayPlan?.goalThread || null;
  const stressRelief = todayPlan?.stressRelief || null;
  const eveningPrompt = todayPlan?.eveningPrompt || null;
  const showEveningReflection = isEvening() && !reflection && planItems.length > 0;

  const handleTap = async (index) => {
    if (completed[index]) return;

    if (!isSubscribed) {
      try {
        const raw = await AsyncStorage.getItem('livenew:plan_count');
        const count = raw ? parseInt(raw, 10) : 0;
        if (count > 7) {
          navigation.navigate('Paywall', { planPreview: todayPlan });
          return;
        }
      } catch {}
    }

    tapLight();

    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else {
      setExpandedIndex(index);
    }
  };

  const handleReflection = (feeling) => {
    tapSuccess();
    submitReflection(feeling);
  };

  const handleSaveRoutine = async () => {
    if (routineText.trim().length < 10) return;
    setSavingRoutine(true);
    try {
      await saveRoutine(routineText.trim());
      setShowRoutinePrompt(false);
    } catch {}
    setSavingRoutine(false);
  };

  if (!todayPlan) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      </SafeAreaView>
    );
  }

  if (planItems.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={s.greeting}>Something went wrong</Text>
          <Text style={{ color: colors.muted, marginBottom: 24 }}>Your plan didn't generate properly.</Text>
          <TouchableOpacity style={s.goldBtn} onPress={() => navigation.replace('StressTap')} activeOpacity={0.8}>
            <Text style={s.goldBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <Text style={s.greeting}>{getGreeting()}</Text>
        {streak >= 1 && <Text style={s.streakText}>Day {streak}</Text>}

        {/* Right Now Zone */}
        {rightNowText && (
          <View style={s.rightNowCard}>
            <Text style={s.rightNowLabel}>RIGHT NOW</Text>
            <Text style={s.rightNowText}>{rightNowText}</Text>
          </View>
        )}

        {/* Goal Thread */}
        {goalThread && (
          <View style={s.goalCard}>
            <Text style={s.goalCardLabel}>THIS WEEK</Text>
            <Text style={s.goalFocus}>{goalThread.weeklyFocus}</Text>
            <Text style={s.goalConnection}>{goalThread.todayConnection}</Text>
          </View>
        )}

        {/* Plan Items */}
        <Text style={s.sectionLabel}>YOUR PLAN</Text>

        {planItems.map((item, index) => {
          const isDone = !!completed[index];
          const isExpanded = expandedIndex === index && !isDone;

          return (
            <TouchableOpacity
              key={index}
              style={[
                s.card,
                isDone && s.cardDone,
                isExpanded && s.cardExpanded,
              ]}
              onPress={() => handleTap(index)}
              activeOpacity={0.7}
              disabled={isDone}
            >
              <View style={s.cardTop}>
                <View style={s.cardLeft}>
                  {isDone ? (
                    <View style={s.checkDone}>
                      <Text style={s.checkMark}>{'\u2713'}</Text>
                    </View>
                  ) : (
                    <View style={[
                      s.checkEmpty,
                      item.type === 'breathe' && { borderColor: colors.gold },
                      item.type === 'food' && { borderColor: colors.success },
                      item.type === 'mindset' && { borderColor: colors.accent },
                    ]} />
                  )}
                  <View style={s.cardContent}>
                    <Text style={s.cardMoment}>{item.moment}</Text>
                    <Text style={[s.cardTitle, isDone && s.cardTitleDone]}>{item.title}</Text>
                  </View>
                </View>
                <View style={s.typeBadge}>
                  <Text style={s.typeBadgeText}>
                    {item.type === 'breathe' ? 'BREATHE' : item.type === 'food' ? 'FOOD' : item.type === 'mindset' ? 'MINDSET' : 'HABIT'}
                  </Text>
                </View>
              </View>

              {isExpanded && (
                <View style={s.expandedWrap}>
                  <Text style={s.insightText}>{item.insight}</Text>
                  {item.goalConnection && (
                    <View style={s.goalTag}>
                      <Text style={s.goalTagText}>{item.goalConnection}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={s.gotItBtn}
                    onPress={() => { tapSuccess(); markDone(index); setExpandedIndex(null); }}
                    activeOpacity={0.8}
                  >
                    <Text style={s.gotItText}>Got it</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Routine upgrade prompt — shown after first plan if no routine yet */}
        {!hasRoutine && !showRoutinePrompt && (streak >= 2 || doneCount >= 1) && (
          <TouchableOpacity
            style={s.routinePromptCard}
            onPress={() => { tapLight(); setShowRoutinePrompt(true); }}
            activeOpacity={0.7}
          >
            <Text style={s.routinePromptTitle}>Want your plan to match your actual day?</Text>
            <Text style={s.routinePromptSub}>Tell me your routine and tomorrow's plan will be specific to your schedule.</Text>
          </TouchableOpacity>
        )}

        {/* Evening Reflection */}
        {showEveningReflection && (
          <View style={s.reflectionCard}>
            <Text style={s.reflectionLabel}>EVENING CHECK-IN</Text>
            <Text style={s.reflectionPrompt}>{eveningPrompt || 'How was today?'}</Text>
            <View style={s.reflectionOptions}>
              {[
                { label: 'Better', value: 'better', emoji: '\u2B06\uFE0F' },
                { label: 'Same', value: 'same', emoji: '\u27A1\uFE0F' },
                { label: 'Harder', value: 'harder', emoji: '\u2B07\uFE0F' },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={s.reflectionBtn}
                  onPress={() => handleReflection(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={s.reflectionEmoji}>{opt.emoji}</Text>
                  <Text style={s.reflectionBtnText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Reflection submitted */}
        {reflection && (
          <View style={s.reflectionDoneCard}>
            <Text style={s.reflectionDoneText}>
              {reflection === 'better' ? 'Glad today was better.' : reflection === 'harder' ? 'Tomorrow we adjust.' : 'Noted. Consistency compounds.'}
            </Text>
          </View>
        )}

        {/* Bottom actions */}
        <View style={s.bottomActions}>
          {stressNoted && (
            <Text style={s.stressNotedText}>Noted. Tomorrow's plan will account for today.</Text>
          )}

          {stressRelief && (
            <TouchableOpacity
              style={s.stressBtn}
              onPress={() => {
                tapSelect();
                setShowStressRelief(true);
                api.feedback({ type: 'stress_spike', dateISO: getLocalDateISO() }).catch(() => {});
              }}
              activeOpacity={0.7}
            >
              <Text style={s.stressBtnText}>I'm stressed right now</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={s.recheckBtn}
            onPress={() => { tapSelect(); navigation.replace('StressTap'); }}
            activeOpacity={0.7}
          >
            <Text style={s.recheckText}>Feeling different? Re-check</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Stress Relief Modal */}
      <Modal
        visible={showStressRelief}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStressRelief(false)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowStressRelief(false)}
        >
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Right now, do this:</Text>
            <Text style={s.modalBody}>{stressRelief}</Text>
            <TouchableOpacity
              style={s.modalBtn}
              onPress={() => {
                tapLight();
                setShowStressRelief(false);
                setStressNoted(true);
                setTimeout(() => setStressNoted(false), 4000);
              }}
              activeOpacity={0.8}
            >
              <Text style={s.modalBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Routine Input Modal */}
      <Modal
        visible={showRoutinePrompt}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRoutinePrompt(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.routineModalWrap}>
          <View style={s.routineModalContent}>
            <Text style={s.routineModalTitle}>Describe your daily routine</Text>
            <Text style={s.routineModalSub}>When do you wake up, work, eat, and wind down? The more detail, the more personalized your plan.</Text>
            <TextInput
              style={s.routineInput}
              placeholder="I wake up at 7, work from 9-5, eat lunch at noon, gym after work, bed by 11..."
              placeholderTextColor={colors.dim}
              value={routineText}
              onChangeText={setRoutineText}
              multiline
              textAlignVertical="top"
              maxLength={1000}
              autoFocus
            />
            <TouchableOpacity
              style={[s.routineSaveBtn, routineText.trim().length < 10 && { opacity: 0.4 }]}
              onPress={handleSaveRoutine}
              disabled={routineText.trim().length < 10 || savingRoutine}
              activeOpacity={0.8}
            >
              <Text style={s.routineSaveBtnText}>{savingRoutine ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.routineSkipBtn} onPress={() => setShowRoutinePrompt(false)} activeOpacity={0.7}>
              <Text style={s.routineSkipText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  greeting: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 2 },
  streakText: { fontSize: 14, color: colors.gold, fontWeight: '600', marginBottom: 4 },

  // Right Now zone
  rightNowCard: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderRadius: 14,
    padding: 18,
    marginTop: 16,
    marginBottom: 16,
  },
  rightNowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  rightNowText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
  },

  // Goal thread
  goalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  goalCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  goalFocus: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  goalConnection: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  // Plan cards
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardDone: { opacity: 0.45 },
  cardExpanded: { borderColor: colors.gold },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  checkEmpty: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.dim, marginRight: 14,
  },
  checkDone: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  checkMark: { color: colors.bg, fontSize: 12, fontWeight: '700' },
  cardContent: { flex: 1 },
  cardMoment: { fontSize: 13, color: colors.gold, fontWeight: '500', marginBottom: 2 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardTitleDone: { textDecorationLine: 'line-through', color: colors.muted },
  typeBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 0.8,
  },

  // Expanded
  expandedWrap: {
    paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  insightText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
    marginBottom: 12,
  },
  goalTag: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.goldSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  goalTagText: { fontSize: 13, color: colors.gold, lineHeight: 18 },
  gotItBtn: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  gotItText: { color: colors.gold, fontSize: 15, fontWeight: '600' },

  // Routine prompt
  routinePromptCard: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    padding: 18,
    marginTop: 12,
  },
  routinePromptTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.gold,
    marginBottom: 4,
  },
  routinePromptSub: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },

  // Evening reflection
  reflectionCard: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    padding: 18,
    marginTop: 16,
  },
  reflectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  reflectionPrompt: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 16,
    lineHeight: 23,
  },
  reflectionOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  reflectionBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  reflectionEmoji: { fontSize: 18 },
  reflectionBtnText: { fontSize: 13, fontWeight: '500', color: colors.text },

  // Reflection done
  reflectionDoneCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    alignItems: 'center',
  },
  reflectionDoneText: {
    fontSize: 14,
    color: colors.muted,
    fontStyle: 'italic',
  },

  // Bottom actions
  bottomActions: { marginTop: 20, gap: 4 },
  stressBtn: {
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stressBtnText: { color: colors.gold, fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  stressNotedText: { color: colors.muted, fontSize: 13, textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },
  recheckBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  recheckText: { color: colors.muted, fontSize: 13 },

  // Stress relief modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.line,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  modalBody: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 24,
  },
  modalBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },

  // Routine modal
  routineModalWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  routineModalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  routineModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  routineModalSub: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 16,
  },
  routineInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 120,
    lineHeight: 22,
    marginBottom: 16,
  },
  routineSaveBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  routineSaveBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  routineSkipBtn: {
    alignItems: 'center',
    marginTop: 12,
    padding: 8,
  },
  routineSkipText: { color: colors.muted, fontSize: 14 },

  // Shared
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
});
