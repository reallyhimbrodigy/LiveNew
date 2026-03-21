import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect } from '../haptics';
import { maybePromptReview } from '../reviewPrompt';

export default function TodayScreen({ navigation }) {
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const streak = useAuthStore(s => s.streak);
  const [completedItems, setCompletedItems] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  // Redirect to stress tap if no plan for today
  useEffect(() => {
    const checkPlan = async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (todayPlan && todayDate === today) return;

      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.date === today && cached.contract) {
            useAuthStore.setState({
              todayPlan: cached.contract,
              todayDate: cached.date,
              todayStress: cached.stress,
            });
            setCompletedItems(cached.completedSessions || {});
            return;
          }
        }
      } catch {}

      navigation.replace('StressTap');
    };
    checkPlan();
  }, []);

  // New day detection
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const today = new Date().toISOString().slice(0, 10);
        if (todayDate !== today) navigation.replace('StressTap');
      }
    });
    return () => sub.remove();
  }, [todayDate]);

  // Reload completion state on focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const AsyncStorage = require('@react-native-async-storage/async-storage').default;
          const raw = await AsyncStorage.getItem('livenew:plan');
          if (raw) {
            const plan = JSON.parse(raw);
            const completed = plan.completedSessions || {};
            setCompletedItems(completed);

            const interventions = plan.contract?.interventions || [];
            const allComplete = interventions.length > 0 && interventions.every((_, i) => completed[i]);
            if (allComplete) maybePromptReview();
          }
        } catch {}
      })();
    }, [])
  );

  const interventions = todayPlan?.interventions || [];
  const breatheItems = interventions.filter(i => i.type === 'breathe');
  const habitItems = interventions.filter(i => i.type === 'habit');
  const foodItems = interventions.filter(i => i.type === 'food');
  const allItems = interventions.map((item, i) => ({ ...item, index: i, done: !!completedItems[i] }));
  const allDone = allItems.length > 0 && allItems.every(i => i.done);
  const nextItem = allItems.find(i => !i.done);
  const doneItems = allItems.filter(i => i.done);

  const handleTapIntervention = async (item) => {
    tapLight();

    // Check trial
    if (!isSubscribed) {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const raw = await AsyncStorage.getItem('livenew:plan_count');
        const count = raw ? parseInt(raw, 10) : 0;
        if (count > 7) {
          navigation.navigate('Paywall', { planPreview: todayPlan });
          return;
        }
      } catch {}
    }

    if (item.type === 'breathe' && item.minutes) {
      // Navigate to breathing session
      navigation.navigate('Session', {
        session: {
          title: item.title,
          phases: [{ instruction: item.action, minutes: item.minutes }],
        },
        onCompleteKey: item.index,
      });
    } else {
      // Habit or food — mark as done immediately
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const plan = JSON.parse(raw);
          if (!plan.completedSessions) plan.completedSessions = {};
          plan.completedSessions[item.index] = true;
          await AsyncStorage.setItem('livenew:plan', JSON.stringify(plan));
          setCompletedItems(prev => ({ ...prev, [item.index]: true }));
        }
      } catch {}
    }
  };

  const handleRecheck = () => {
    tapSelect();
    navigation.replace('StressTap');
  };

  if (!todayPlan) return null;

  if (interventions.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={s.greeting}>Something went wrong</Text>
          <Text style={[s.sub, { marginBottom: 24 }]}>Your plan didn't generate properly.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={handleRecheck} activeOpacity={0.8}>
            <Text style={s.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {}} tintColor={colors.gold} />}
      >
        <Text style={s.greeting}>{getGreeting()}</Text>
        <Text style={s.sub}>
          {allDone
            ? "You've completed everything today."
            : `${interventions.length} interventions for your day`
          }
        </Text>
        {streak > 1 && <Text style={s.streakText}>{streak} day streak 🔥</Text>}

        {/* All done celebration */}
        {allDone && (
          <View style={s.celebrateWrap}>
            <Text style={s.celebrateEmoji}>🎉</Text>
            <Text style={s.celebrateTitle}>You did it</Text>
            <Text style={s.celebrateSub}>Your cortisol is on track tonight.</Text>
          </View>
        )}

        {/* Next up card */}
        {!allDone && nextItem && (
          <TouchableOpacity
            style={s.nextCard}
            onPress={() => handleTapIntervention(nextItem)}
            activeOpacity={0.8}
          >
            <View style={s.nowBadge}>
              <Text style={s.nowText}>
                {nextItem.type === 'breathe' ? 'BREATHE' : nextItem.type === 'food' ? 'EAT' : 'DO THIS'}
              </Text>
            </View>
            <Text style={s.nextMoment}>{nextItem.moment}</Text>
            <Text style={s.nextTitle}>{nextItem.title}</Text>
            <Text style={s.nextDesc}>{nextItem.description}</Text>
            {nextItem.type === 'breathe' && nextItem.minutes && (
              <Text style={s.nextMeta}>{nextItem.minutes} min</Text>
            )}
            <View style={s.nextAction}>
              <Text style={s.nextActionText}>
                {nextItem.type === 'breathe' ? 'Start' : nextItem.type === 'food' ? 'Got it' : 'Done'}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Completed items */}
        {doneItems.length > 0 && !allDone && (
          <View style={s.doneSection}>
            {doneItems.map(item => (
              <View key={item.index} style={s.doneRow}>
                <Text style={s.doneCheck}>✓</Text>
                <Text style={s.doneTitle}>{item.title}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Rest of today */}
        {!allDone && allItems.filter(i => !i.done && i !== nextItem).length > 0 && (
          <View style={s.laterSection}>
            <View style={s.sectionHeader}>
              <View style={s.sectionLine} />
              <Text style={s.sectionLabel}>Later today</Text>
              <View style={s.sectionLine} />
            </View>
            {allItems.filter(i => !i.done && i !== nextItem).map(item => (
              <TouchableOpacity
                key={item.index}
                style={s.laterCard}
                onPress={() => handleTapIntervention(item)}
                activeOpacity={0.7}
              >
                <View style={s.laterTop}>
                  <View style={[s.typeBadge, item.type === 'breathe' && s.typeBreathe, item.type === 'food' && s.typeFood]}>
                    <Text style={s.typeText}>
                      {item.type === 'breathe' ? '🫁' : item.type === 'food' ? '🍽' : '⚡'}
                    </Text>
                  </View>
                  <View style={s.laterContent}>
                    <Text style={s.laterMoment}>{item.moment}</Text>
                    <Text style={s.laterTitle}>{item.title}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Recheck */}
        {!allDone && (
          <TouchableOpacity style={s.recheckBtn} onPress={handleRecheck} activeOpacity={0.7}>
            <Text style={s.recheckText}>Feeling different? Re-check</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  greeting: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 4 },
  sub: { fontSize: 14, color: colors.muted, marginBottom: 4 },
  streakText: { fontSize: 14, color: colors.gold, fontWeight: '600', marginBottom: 20 },

  // Next card
  nextCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 16,
    padding: 22,
    marginTop: 16,
    marginBottom: 16,
  },
  nowBadge: {
    backgroundColor: 'rgba(196,168,108,0.15)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  nowText: { fontSize: 11, fontWeight: '700', color: colors.gold, letterSpacing: 1.5 },
  nextMoment: { fontSize: 13, color: colors.gold, fontWeight: '500', marginBottom: 6 },
  nextTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8, lineHeight: 26 },
  nextDesc: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  nextMeta: { fontSize: 13, color: colors.dim, marginBottom: 14 },
  nextAction: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  nextActionText: { color: colors.bg, fontSize: 16, fontWeight: '600' },

  // Done items
  doneSection: { marginBottom: 16 },
  doneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  doneCheck: { color: colors.gold, fontSize: 14, fontWeight: '600', marginRight: 10 },
  doneTitle: { color: colors.gold, fontSize: 14 },

  // Later section
  laterSection: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.line },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: colors.dim, textTransform: 'uppercase', letterSpacing: 1 },

  laterCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  laterTop: { flexDirection: 'row', alignItems: 'center' },
  typeBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  typeBreathe: { backgroundColor: 'rgba(196,168,108,0.12)' },
  typeFood: { backgroundColor: 'rgba(122,173,122,0.12)' },
  typeText: { fontSize: 16 },
  laterContent: { flex: 1 },
  laterMoment: { fontSize: 12, color: colors.dim, marginBottom: 2 },
  laterTitle: { fontSize: 15, fontWeight: '500', color: colors.text },

  // Recheck
  recheckBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  recheckText: { color: colors.muted, fontSize: 14 },

  // Retry
  retryBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  retryBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },

  // Celebrate
  celebrateWrap: { alignItems: 'center', paddingVertical: 32 },
  celebrateEmoji: { fontSize: 48, marginBottom: 16 },
  celebrateTitle: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 8 },
  celebrateSub: { fontSize: 15, color: colors.muted, textAlign: 'center' },
});
