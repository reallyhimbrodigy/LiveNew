import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';

export default function TodayScreen({ navigation }) {
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);
  const todayStress = useAuthStore(s => s.todayStress);
  const [completedSessions, setCompletedSessions] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!todayPlan || todayDate !== today) {
      navigation.replace('StressTap');
    }
  }, [todayPlan, todayDate]);

  // Load completion state from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const plan = JSON.parse(raw);
          setCompletedSessions(plan.completedSessions || {});
        }
      } catch {}
    })();
  }, [todayPlan]);

  const sessions = todayPlan?.sessions || [];
  const meals = todayPlan?.meals || [];

  const sessionList = sessions.map((s, i) => ({
    ...s,
    index: i,
    done: !!completedSessions[i],
  }));

  const allDone = sessionList.length > 0 && sessionList.every(s => s.done);
  const nextSession = sessionList.find(s => !s.done);
  const afterNext = sessionList.find(s => !s.done && s !== nextSession);
  const doneSessions = sessionList.filter(s => s.done);

  const handleStartSession = (session) => {
    navigation.navigate('Session', {
      session,
      onCompleteKey: session.index,
    });
  };

  const handleRecheck = () => {
    navigation.replace('StressTap');
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Reload completion state
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const raw = await AsyncStorage.getItem('livenew:plan');
      if (raw) {
        const plan = JSON.parse(raw);
        setCompletedSessions(plan.completedSessions || {});
      }
    } catch {}
    setRefreshing(false);
  }, []);

  if (!todayPlan) return null;

  // Calculate total minutes for today
  const totalMin = sessions.reduce((sum, s) =>
    sum + (s.phases || []).reduce((ps, p) => ps + (p.minutes || 0), 0), 0
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
      >
        {/* Header */}
        <Text style={s.logo}>LiveNew</Text>
        <Text style={s.greeting}>{getGreeting()}</Text>
        <Text style={s.sub}>
          {allDone
            ? "You've completed everything today."
            : `${sessions.length} sessions · ${Math.round(totalMin)} min · ${meals.length} meals`
          }
        </Text>

        {/* Completed sessions */}
        {doneSessions.length > 0 && !allDone && (
          <View style={s.completedWrap}>
            {doneSessions.map(ds => (
              <View key={ds.index} style={s.completedRow}>
                <Text style={s.completedCheck}>✓</Text>
                <Text style={s.completedText}>{ds.title}</Text>
              </View>
            ))}
          </View>
        )}

        {/* All done */}
        {allDone && (
          <View style={s.allDoneWrap}>
            <Text style={s.allDoneEmoji}>✓</Text>
            <Text style={s.allDoneTitle}>Done for today</Text>
            <Text style={s.allDoneSub}>Every session completed. See you tomorrow.</Text>
            {doneSessions.map(ds => (
              <View key={ds.index} style={s.completedRow}>
                <Text style={s.completedCheck}>✓</Text>
                <Text style={s.completedText}>{ds.title}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Active session card */}
        {!allDone && nextSession && (
          <View style={s.activeCard}>
            <Text style={s.activeTime}>{nextSession.time || ''}</Text>
            <Text style={s.activeTitle}>{nextSession.title || ''}</Text>
            <Text style={s.activeDesc}>{nextSession.description || ''}</Text>
            <View style={s.activeMeta}>
              <Text style={s.activeMin}>
                {(nextSession.phases || []).reduce((sum, p) => sum + (p.minutes || 0), 0)} min
              </Text>
              <Text style={s.activeDot}>·</Text>
              <Text style={s.activePhases}>
                {(nextSession.phases || []).length} parts
              </Text>
            </View>
            <TouchableOpacity
              style={s.startBtn}
              onPress={() => handleStartSession(nextSession)}
              activeOpacity={0.8}
            >
              <Text style={s.startBtnText}>Start</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Up next */}
        {!allDone && afterNext && (
          <Text style={s.upNext}>Up next: {afterNext.title} · {afterNext.time}</Text>
        )}

        {/* All sessions timeline */}
        {!allDone && sessionList.length > 1 && (
          <View style={s.timeline}>
            <Text style={s.sectionTitle}>Your day</Text>
            {sessionList.map(ses => (
              <TouchableOpacity
                key={ses.index}
                style={s.timelineRow}
                onPress={() => !ses.done && handleStartSession(ses)}
                disabled={ses.done}
                activeOpacity={0.7}
              >
                <View style={[s.timelineDot, ses.done && s.timelineDotDone]} />
                <View style={s.timelineContent}>
                  <Text style={[s.timelineTitle, ses.done && s.timelineTitleDone]}>
                    {ses.title}
                  </Text>
                  <Text style={s.timelineTime}>{ses.time}</Text>
                </View>
                {ses.done && <Text style={s.timelineCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Meals */}
        {meals.length > 0 && (
          <View style={s.mealsWrap}>
            <Text style={s.sectionTitle}>Meals</Text>
            {meals.map((m, i) => (
              <View key={i} style={s.mealCard}>
                <Text style={s.mealTime}>{m.time}</Text>
                <Text style={s.mealRec}>{m.recommendation}</Text>
              </View>
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

  logo: {
    fontSize: 20,
    fontWeight: '500',
    color: colors.text,
    letterSpacing: 1,
    marginBottom: 20,
  },

  greeting: {
    fontSize: 26,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },

  sub: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 24,
  },

  // Active card
  activeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
  },

  activeTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },

  activeTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    lineHeight: 26,
  },

  activeDesc: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 12,
  },

  activeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },

  activeMin: { fontSize: 13, color: colors.dim },
  activeDot: { fontSize: 13, color: colors.dim, marginHorizontal: 6 },
  activePhases: { fontSize: 13, color: colors.dim },

  startBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },

  startBtnText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '600',
  },

  // Up next
  upNext: {
    fontSize: 13,
    color: colors.dim,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Completed
  completedWrap: {
    marginBottom: 16,
  },

  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },

  completedCheck: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },

  completedText: {
    color: colors.gold,
    fontSize: 14,
  },

  // All done
  allDoneWrap: {
    alignItems: 'center',
    paddingVertical: 32,
  },

  allDoneEmoji: {
    fontSize: 40,
    color: colors.gold,
    marginBottom: 12,
  },

  allDoneTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },

  allDoneSub: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 16,
  },

  // Timeline
  timeline: {
    marginTop: 8,
    marginBottom: 24,
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.goldSoft,
  },

  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.dim,
    marginRight: 14,
  },

  timelineDotDone: {
    backgroundColor: colors.gold,
  },

  timelineContent: {
    flex: 1,
  },

  timelineTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },

  timelineTitleDone: {
    color: colors.muted,
  },

  timelineTime: {
    fontSize: 12,
    color: colors.dim,
    marginTop: 2,
  },

  timelineCheck: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
  },

  // Meals
  mealsWrap: {
    marginBottom: 24,
  },

  mealCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldSoft,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },

  mealTime: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  mealRec: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  // Recheck
  recheckBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },

  recheckText: {
    color: colors.muted,
    fontSize: 14,
  },
});
