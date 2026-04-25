import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, AppState,
  Modal, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
  Animated, LayoutAnimation, UIManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapSuccess } from '../haptics';
import { maybePromptReview } from '../reviewPrompt';
import { getLocalDateISO } from '../utils/localDate';
import { truncateGoal } from '../utils/goalText';
import { cancelPlanItemNotification } from '../notifications';
import { api } from '../api';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function getGreetingParts() {
  const now = new Date();
  const h = now.getHours();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  let part = 'evening';
  if (h < 12) part = 'morning';
  else if (h < 17) part = 'afternoon';
  return { dayOfWeek, partOfDay: part };
}

function isEvening() {
  return new Date().getHours() >= 19;
}

function timeToMinutes(t) {
  if (typeof t !== 'string') return 24 * 60;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatTime(t) {
  if (typeof t !== 'string') return '';
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  let h = Number(m[1]);
  const mm = m[2];
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mm} ${period}`;
}

function PressCard({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => {
        if (disabled) return;
        Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 60, bounciness: 4 }).start();
      }}
      onPress={onPress}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default function TodayScreen({ navigation }) {
  const insets = useSafeAreaInsets();
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

  const [showRoutinePrompt, setShowRoutinePrompt] = useState(false);
  const [routineText, setRoutineText] = useState('');
  const [savingRoutine, setSavingRoutine] = useState(false);

  // Sticky stress button fade on scroll
  const scrollY = useRef(new Animated.Value(0)).current;
  const stressBtnOpacity = scrollY.interpolate({
    inputRange: [0, 80, 200],
    outputRange: [1, 0.6, 0.95],
    extrapolate: 'clamp',
  });

  const hasRoutine = !!(profile?.routine && profile.routine.length > 5);

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

  useEffect(() => {
    const interval = setInterval(() => setTimeOfDay(getTimeOfDay()), 60000);
    return () => clearInterval(interval);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTimeOfDay(getTimeOfDay());
      const items = todayPlan?.plan || [];
      if (items.length > 0 && items.every((_, i) => completed[i])) {
        maybePromptReview();
      }
    }, [completed, todayPlan])
  );

  // Sort plan items chronologically by time. Defense-in-depth — server already sorts.
  const rawItems = todayPlan?.plan || [];
  const planItems = [...rawItems]
    .map((item, originalIndex) => ({ ...item, _idx: originalIndex }))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const doneCount = planItems.filter(i => completed[i._idx]).length;
  const rightNowText = todayPlan?.rightNow?.[timeOfDay] || null;
  const goalThread = todayPlan?.goalThread || null;
  const stressRelief = todayPlan?.stressRelief || null;
  const eveningPrompt = todayPlan?.eveningPrompt || null;
  const showEveningReflection = isEvening() && !reflection && planItems.length > 0;
  const showStressBtn = !!stressRelief && doneCount < planItems.length;

  const { dayOfWeek, partOfDay } = getGreetingParts();

  const handleTap = async (item) => {
    const idx = item._idx;
    if (completed[idx]) return;

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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIndex(expandedIndex === idx ? null : idx);
  };

  const handleGotIt = (idx) => {
    tapSuccess();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    cancelPlanItemNotification(idx);
    markDone(idx);
    setExpandedIndex(null);
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
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      </SafeAreaView>
    );
  }

  if (planItems.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={[s.centered, { padding: 24 }]}>
          <Text style={s.greeting}>Something went wrong</Text>
          <Text style={s.errorBody}>Your plan didn't generate properly.</Text>
          <Pressable
            style={({ pressed }) => [s.goldBtn, pressed && { opacity: 0.85 }]}
            onPress={() => navigation.replace('StressTap')}
          >
            <Text style={s.goldBtnText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: showStressBtn ? 140 : 80 }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >

        {/* Header — serif greeting + streak chip */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.greetingDay}>{dayOfWeek.toLowerCase()}</Text>
            <Text style={s.greetingPart}>{partOfDay}</Text>
          </View>
          {streak >= 1 && (
            <View style={s.streakChip}>
              <Text style={s.streakChipNum}>{streak}</Text>
              <Text style={s.streakChipLabel}>{streak === 1 ? 'day' : 'days'}</Text>
            </View>
          )}
        </View>

        {/* Right Now — hero, gradient */}
        {rightNowText && (
          <View style={s.rightNowCard}>
            <LinearGradient
              colors={['rgba(196,168,108,0.10)', 'rgba(196,168,108,0.02)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.rightNowAccent} />
            <Text style={s.rightNowLabel}>RIGHT NOW</Text>
            <Text style={s.rightNowText}>{rightNowText}</Text>
            {goalThread?.weeklyFocus && (
              <Text style={s.goalThreadLine}>
                {goalThread.weeklyFocus}
              </Text>
            )}
          </View>
        )}

        {/* Plan */}
        <Text style={s.sectionLabel}>YOUR PLAN</Text>

        {planItems.map((item, listIdx) => {
          const idx = item._idx;
          const isDone = !!completed[idx];
          const isExpanded = expandedIndex === idx && !isDone;
          const isFirst = listIdx === 0;
          const isLast = listIdx === planItems.length - 1;

          const accentColor =
            item.type === 'breathe' ? colors.gold :
            item.type === 'food' ? colors.success :
            item.type === 'mindset' ? colors.accent :
            colors.muted;

          return (
            <PressCard
              key={idx}
              onPress={() => handleTap(item)}
              disabled={isDone}
              style={[
                s.planCard,
                !isFirst && { marginTop: 8 },
                isExpanded && s.planCardExpanded,
                isDone && s.planCardDone,
              ]}
            >
              <View style={s.planTopRow}>
                <View style={[s.typeDot, { backgroundColor: accentColor }, isDone && { opacity: 0.4 }]} />
                <View style={s.planTimeWrap}>
                  <Text style={[s.planTime, isDone && s.planTextDone]}>
                    {formatTime(item.time)}
                  </Text>
                </View>
                <View style={s.planContent}>
                  <Text style={[s.planTitle, isDone && s.planTextDone]} numberOfLines={isExpanded ? undefined : 2}>
                    {item.title}
                  </Text>
                  {item.moment && (
                    <Text style={s.planMoment} numberOfLines={1}>
                      {item.moment}
                    </Text>
                  )}
                </View>
                {isDone ? (
                  <View style={s.checkDone}>
                    <Text style={s.checkMark}>{'✓'}</Text>
                  </View>
                ) : (
                  <View style={[s.checkEmpty, { borderColor: accentColor }]} />
                )}
              </View>

              {isExpanded && (
                <View style={s.expandedWrap}>
                  <Text style={s.insightText}>{item.insight}</Text>
                  {item.goalConnection && (
                    <View style={s.goalTag}>
                      <Text style={s.goalTagText}>{item.goalConnection}</Text>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [s.gotItBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => handleGotIt(idx)}
                  >
                    <Text style={s.gotItText}>Got it</Text>
                  </Pressable>
                </View>
              )}
            </PressCard>
          );
        })}

        {/* Routine upgrade prompt */}
        {!hasRoutine && !showRoutinePrompt && (streak >= 2 || doneCount >= 1) && (
          <PressCard
            onPress={() => { tapLight(); setShowRoutinePrompt(true); }}
            style={s.routinePromptCard}
          >
            <Text style={s.routinePromptTitle}>Want plans tuned to your real day?</Text>
            <Text style={s.routinePromptSub}>Tell me your routine and tomorrow's plan will reference your actual schedule.</Text>
          </PressCard>
        )}

        {/* Evening reflection */}
        {showEveningReflection && (
          <View style={s.reflectionCard}>
            <Text style={s.reflectionLabel}>EVENING CHECK-IN</Text>
            <Text style={s.reflectionPrompt}>{eveningPrompt || 'How was today?'}</Text>
            <View style={s.reflectionOptions}>
              {[
                { label: 'Better', value: 'better' },
                { label: 'Same', value: 'same' },
                { label: 'Harder', value: 'harder' },
              ].map(opt => (
                <Pressable
                  key={opt.value}
                  style={({ pressed }) => [s.reflectionBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => handleReflection(opt.value)}
                >
                  <Text style={s.reflectionBtnText}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {reflection && (
          <View style={s.reflectionDoneCard}>
            <Text style={s.reflectionDoneText}>
              {reflection === 'better' ? 'Glad today was better.' : reflection === 'harder' ? 'Tomorrow we adjust.' : 'Noted. Consistency compounds.'}
            </Text>
          </View>
        )}

        {stressNoted && (
          <View style={s.stressNotedCard}>
            <Text style={s.stressNotedText}>Noted. Tomorrow's plan will account for today.</Text>
          </View>
        )}

      </Animated.ScrollView>

      {/* Sticky stress button — fades subtly on scroll */}
      {showStressBtn && (
        <Animated.View style={[s.stressBtnSticky, { bottom: insets.bottom + 12, opacity: stressBtnOpacity }]} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              tapSelect();
              setShowStressRelief(true);
              api.feedback({ type: 'stress_spike', dateISO: getLocalDateISO() }).catch(() => {});
            }}
            style={({ pressed }) => [s.stressBtnInner, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            <View style={s.stressBtnDot} />
            <Text style={s.stressBtnText}>I'm stressed right now</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Stress Relief Modal */}
      <Modal
        visible={showStressRelief}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStressRelief(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowStressRelief(false)}>
          <Pressable style={s.modalContent} onPress={() => {}}>
            <Text style={s.modalLabel}>RIGHT NOW, DO THIS</Text>
            <Text style={s.modalBody}>{stressRelief}</Text>
            <Pressable
              style={({ pressed }) => [s.modalBtn, pressed && { opacity: 0.85 }]}
              onPress={() => {
                tapLight();
                setShowStressRelief(false);
                setStressNoted(true);
                setTimeout(() => setStressNoted(false), 4000);
              }}
            >
              <Text style={s.modalBtnText}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
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
            <Text style={s.routineModalSub}>Wake, work, eat, wind down. The more detail, the more your plan reflects your actual day.</Text>
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
            <Pressable
              style={({ pressed }) => [s.routineSaveBtn, (routineText.trim().length < 10 || savingRoutine) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              onPress={handleSaveRoutine}
              disabled={routineText.trim().length < 10 || savingRoutine}
            >
              <Text style={s.routineSaveBtnText}>{savingRoutine ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable style={s.routineSkipBtn} onPress={() => setShowRoutinePrompt(false)}>
              <Text style={s.routineSkipText}>Maybe later</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 80 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBody: { color: colors.muted, marginBottom: 24, textAlign: 'center' },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 4,
    paddingBottom: 18,
  },
  greetingDay: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.text,
    letterSpacing: 0.2,
    marginBottom: -2,
  },
  greetingPart: {
    fontFamily: fonts.displayItalic,
    fontSize: 22,
    color: colors.muted,
    letterSpacing: 0.2,
  },
  streakChip: {
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 52,
    marginLeft: 12,
  },
  streakChipNum: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.gold,
    lineHeight: 22,
  },
  streakChipLabel: {
    fontSize: 9,
    color: colors.gold,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: -2,
  },

  // Right Now hero
  rightNowCard: {
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
    paddingLeft: 26,
    marginBottom: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  rightNowAccent: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 3,
    backgroundColor: colors.gold,
  },
  rightNowLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 2,
    marginBottom: 10,
  },
  rightNowText: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
    lineHeight: 27,
    letterSpacing: 0.1,
  },
  goalThreadLine: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
    fontStyle: 'italic',
  },

  // Section label
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 2,
    marginBottom: 14,
    marginLeft: 2,
  },

  // Plan card
  planCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    overflow: 'hidden',
  },
  planCardExpanded: {
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  planCardDone: { opacity: 0.5 },
  planTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    paddingLeft: 14,
  },
  typeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 12,
  },
  planTimeWrap: {
    width: 62,
    marginRight: 14,
  },
  planTime: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    color: colors.gold,
    letterSpacing: 0.2,
  },
  planContent: { flex: 1, marginRight: 8 },
  planTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
    marginBottom: 2,
  },
  planMoment: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  planTextDone: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  checkEmpty: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2,
  },
  checkDone: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: colors.bg, fontSize: 12, fontWeight: '700' },

  // Expanded
  expandedWrap: {
    paddingHorizontal: 22,
    paddingBottom: 18,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  insightText: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
    lineHeight: 24,
    marginBottom: 14,
    letterSpacing: 0.1,
  },
  goalTag: {
    backgroundColor: 'rgba(196,168,108,0.06)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  goalTagText: { fontSize: 13, color: colors.gold, lineHeight: 18, fontStyle: 'italic' },
  gotItBtn: {
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  gotItText: { color: colors.gold, fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },

  // Routine prompt
  routinePromptCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    marginTop: 20,
  },
  routinePromptTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.text,
    marginBottom: 4,
  },
  routinePromptSub: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  // Evening reflection
  reflectionCard: {
    borderRadius: 14,
    padding: 18,
    marginTop: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  reflectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 2,
    marginBottom: 8,
  },
  reflectionPrompt: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.text,
    lineHeight: 25,
    marginBottom: 16,
  },
  reflectionOptions: { flexDirection: 'row', gap: 8 },
  reflectionBtn: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reflectionBtnText: { fontSize: 14, fontWeight: '500', color: colors.text },

  reflectionDoneCard: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    marginTop: 16,
    alignItems: 'center',
  },
  reflectionDoneText: {
    fontFamily: fonts.displayItalic,
    fontSize: 14,
    color: colors.muted,
  },

  stressNotedCard: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  stressNotedText: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },

  // Sticky stress button
  stressBtnSticky: {
    position: 'absolute',
    left: 22,
    right: 22,
    alignItems: 'stretch',
  },
  stressBtnInner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  stressBtnDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  stressBtnText: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 26,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  modalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 2,
    marginBottom: 12,
  },
  modalBody: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.text,
    lineHeight: 27,
    marginBottom: 22,
  },
  modalBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },

  // Routine modal
  routineModalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  routineModalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  routineModalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.text,
    marginBottom: 6,
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    minHeight: 120,
    lineHeight: 22,
    marginBottom: 16,
  },
  routineSaveBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  routineSaveBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  routineSkipBtn: { alignItems: 'center', marginTop: 12, padding: 8 },
  routineSkipText: { color: colors.muted, fontSize: 14 },

  // Shared
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
  greeting: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 8, fontFamily: fonts.display },
});
