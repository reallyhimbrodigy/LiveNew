import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapSuccess } from '../haptics';
import { maybePromptReview } from '../reviewPrompt';

export default function TodayScreen({ navigation }) {
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);
  const isSubscribed = useAuthStore(s => s.isSubscribed);
  const streak = useAuthStore(s => s.streak);
  const [completed, setCompleted] = useState({});
  const [expandedIndex, setExpandedIndex] = useState(null);

  useEffect(() => {
    const check = async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (todayPlan && todayDate === today) return;
      try {
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.date === today && cached.contract) {
            useAuthStore.setState({ todayPlan: cached.contract, todayDate: cached.date, todayStress: cached.stress });
            setCompleted(cached.completedSessions || {});
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
        const today = new Date().toISOString().slice(0, 10);
        if (todayDate !== today) navigation.replace('StressTap');
      }
    });
    return () => sub.remove();
  }, [todayDate]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const raw = await AsyncStorage.getItem('livenew:plan');
          if (raw) {
            const plan = JSON.parse(raw);
            const c = plan.completedSessions || {};
            setCompleted(c);
            const items = plan.contract?.interventions || [];
            if (items.length > 0 && items.every((_, i) => c[i])) maybePromptReview();
          }
        } catch {}
      })();
    }, [])
  );

  const interventions = todayPlan?.interventions || [];
  const items = interventions.map((item, i) => ({ ...item, index: i, done: !!completed[i] }));
  const allDone = items.length > 0 && items.every(i => i.done);
  const doneCount = items.filter(i => i.done).length;

  const markDone = async (index) => {
    tapSuccess();
    try {
      const raw = await AsyncStorage.getItem('livenew:plan');
      if (raw) {
        const plan = JSON.parse(raw);
        if (!plan.completedSessions) plan.completedSessions = {};
        plan.completedSessions[index] = true;
        await AsyncStorage.setItem('livenew:plan', JSON.stringify(plan));
        setCompleted(prev => ({ ...prev, [index]: true }));
      }
    } catch {}
  };

  const handleTap = async (item) => {
    if (item.done) return;

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

    if (expandedIndex === item.index) {
      markDone(item.index);
      setExpandedIndex(null);
    } else {
      setExpandedIndex(item.index);
    }
  };

  if (!todayPlan) return null;

  if (interventions.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={s.heading}>Something went wrong</Text>
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

        <Text style={s.heading}>{getGreeting()}</Text>

        <View style={s.progressWrap}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: items.length > 0 ? `${(doneCount / items.length) * 100}%` : '0%' }]} />
          </View>
          <Text style={s.progressText}>{doneCount} of {items.length} done</Text>
        </View>

        {streak > 1 && <Text style={s.streakText}>{streak} day streak 🔥</Text>}

        {allDone && (
          <View style={s.celebrateWrap}>
            <Text style={s.celebrateEmoji}>🎉</Text>
            <Text style={s.celebrateTitle}>You did it</Text>
            <Text style={s.celebrateSub}>Your cortisol is on track tonight.</Text>
          </View>
        )}

        {items.map(item => (
          <TouchableOpacity
            key={item.index}
            style={[
              s.card,
              item.done && s.cardDone,
              expandedIndex === item.index && s.cardExpanded,
            ]}
            onPress={() => handleTap(item)}
            activeOpacity={0.7}
            disabled={item.done}
          >
            <View style={s.cardTop}>
              <View style={s.cardLeft}>
                {item.done ? (
                  <View style={s.checkDone}>
                    <Text style={s.checkMark}>✓</Text>
                  </View>
                ) : (
                  <View style={[
                    s.checkEmpty,
                    item.type === 'breathe' && { borderColor: colors.gold },
                    item.type === 'food' && { borderColor: '#7aad7a' },
                  ]} />
                )}
                <View style={s.cardContent}>
                  <Text style={s.cardMoment}>{item.moment}</Text>
                  <Text style={[s.cardTitle, item.done && s.cardTitleDone]}>{item.title}</Text>
                </View>
              </View>
              <Text style={s.typeIcon}>
                {item.type === 'breathe' ? '🫁' : item.type === 'food' ? '🍽' : '⚡'}
              </Text>
            </View>

            {expandedIndex === item.index && !item.done && (
              <View style={s.expandedWrap}>
                <Text style={s.actionText}>{item.action}</Text>
                <TouchableOpacity
                  style={s.doneBtn}
                  onPress={() => { markDone(item.index); setExpandedIndex(null); }}
                  activeOpacity={0.8}
                >
                  <Text style={s.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        ))}

        {!allDone && (
          <TouchableOpacity style={s.recheckBtn} onPress={() => { tapSelect(); navigation.replace('StressTap'); }} activeOpacity={0.7}>
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
  heading: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 16 },
  progressWrap: { marginBottom: 16 },
  progressBg: { height: 4, backgroundColor: colors.line, borderRadius: 2, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: colors.gold, borderRadius: 2 },
  progressText: { fontSize: 13, color: colors.dim },
  streakText: { fontSize: 14, color: colors.gold, fontWeight: '600', marginBottom: 16 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14, marginBottom: 8, overflow: 'hidden' },
  cardDone: { opacity: 0.5 },
  cardExpanded: { borderColor: colors.gold },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  checkEmpty: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.dim, marginRight: 14 },
  checkDone: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  checkMark: { color: colors.bg, fontSize: 12, fontWeight: '700' },
  cardContent: { flex: 1 },
  cardMoment: { fontSize: 12, color: colors.gold, fontWeight: '500', marginBottom: 2 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardTitleDone: { textDecorationLine: 'line-through', color: colors.muted },
  typeIcon: { fontSize: 16, marginLeft: 8 },
  expandedWrap: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.line },
  actionText: { fontSize: 15, color: colors.text, lineHeight: 22, marginBottom: 14 },
  doneBtn: { backgroundColor: colors.gold, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  doneBtnText: { color: colors.bg, fontSize: 15, fontWeight: '600' },
  recheckBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  recheckText: { color: colors.muted, fontSize: 14 },
  celebrateWrap: { alignItems: 'center', paddingVertical: 32 },
  celebrateEmoji: { fontSize: 48, marginBottom: 16 },
  celebrateTitle: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 8 },
  celebrateSub: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
});
