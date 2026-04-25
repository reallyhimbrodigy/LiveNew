import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { api } from '../api';
import { useAuthStore } from '../store/authStore';

export default function ProgressScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const streak = useAuthStore(s => s.streak);
  const profile = useAuthStore(s => s.profile);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.progress();
        setData(res?.progress || null);
      } catch {
        setError(true);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const rawTrend = data?.stressTrend || [];
  const trend = [...rawTrend].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const consistency = data?.consistency || {};
  const stressAvg = data?.stressAvg7;
  const totalSessions = (consistency.movementCompleted || 0) + (consistency.resetsCompleted || 0) + (consistency.winddownsCompleted || 0);
  const weeklySummary = data?.weeklySummary || null;
  const insight = data?.insight || null;
  const reflections = Array.isArray(data?.reflections) ? data.reflections : [];

  // Reflection breakdown for last 7 days
  const recentReflections = reflections.slice(-7);
  const reflectionCounts = recentReflections.reduce((acc, r) => {
    acc[r.feeling] = (acc[r.feeling] || 0) + 1;
    return acc;
  }, { better: 0, same: 0, harder: 0 });

  // Calculate insights (trend is now sorted chronologically asc)
  const recentTrend = trend.slice(-7);
  const olderTrend = trend.slice(-14, -7);
  const recentAvg = recentTrend.length > 0
    ? recentTrend.reduce((sum, t) => sum + (t.stress || 0), 0) / recentTrend.length
    : null;
  const olderAvg = olderTrend.length > 0
    ? olderTrend.reduce((sum, t) => sum + (t.stress || 0), 0) / olderTrend.length
    : null;
  const stressChange = recentAvg && olderAvg ? olderAvg - recentAvg : null;

  // Best day
  const bestDay = trend.length > 0
    ? trend.reduce((best, t) => (t.stress < (best?.stress || 999)) ? t : best, null)
    : null;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayInitials = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
  const daysActive = consistency.checkinDays || 0;

  // Chart slice (trend is already sorted chronologically asc)
  const chartTrend = trend.slice(-14);
  const minStress = chartTrend.length > 0
    ? Math.min(...chartTrend.map(t => t.stress ?? 999))
    : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.heading}>Progress</Text>

        {/* Goal reminder */}
        {profile?.goal && (
          <View style={s.goalCard}>
            <Text style={s.goalLabel}>YOUR GOAL</Text>
            <Text style={s.goalText} numberOfLines={2}>{profile.goal}</Text>
          </View>
        )}

        {/* Story card — the main narrative */}
        {daysActive >= 2 && (
          <View style={s.storyCard}>
            <Text style={s.storyText}>
              {buildStoryText({ daysActive, streak, stressChange, stressAvg, recentAvg, totalSessions, bestDay, dayNames })}
            </Text>
          </View>
        )}

        {/* AI insight */}
        {insight && (
          <View style={s.insightCard}>
            <Text style={s.insightLabel}>THIS WEEK</Text>
            <Text style={s.insightText}>{insight}</Text>
          </View>
        )}

        {/* Summary cards row */}
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{daysActive}</Text>
            <Text style={s.summaryLabel}>Days</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{totalSessions}</Text>
            <Text style={s.summaryLabel}>Done</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{streak || 0}</Text>
            <Text style={s.summaryLabel}>Streak</Text>
          </View>
        </View>

        {/* Key insights */}
        {(stressChange !== null || bestDay || stressAvg != null) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Insights</Text>
            {stressChange !== null && (
              <View style={s.insightRow}>
                <View style={[s.insightIcon, { backgroundColor: stressChange > 0 ? colors.successBg : colors.errorBg }]}>
                  <Text style={{ color: stressChange > 0 ? colors.success : colors.error, fontSize: 16, fontWeight: '700' }}>
                    {stressChange > 0 ? '\u2193' : '\u2191'}
                  </Text>
                </View>
                <View style={s.insightContent}>
                  <Text style={s.insightTitle}>
                    {stressChange > 0 ? 'Stress is dropping' : 'Stress is rising'}
                  </Text>
                  <Text style={s.insightSub}>
                    {stressChange > 0
                      ? `Down ${stressChange.toFixed(1)} points vs last week`
                      : `Up ${Math.abs(stressChange).toFixed(1)} points vs last week`
                    }
                  </Text>
                </View>
              </View>
            )}
            {bestDay && (
              <View style={s.insightRow}>
                <View style={[s.insightIcon, { backgroundColor: colors.goldBorder }]}>
                  <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '700' }}>{'\u2605'}</Text>
                </View>
                <View style={s.insightContent}>
                  <Text style={s.insightTitle}>Best day</Text>
                  <Text style={s.insightSub}>
                    {bestDay.date ? `${dayNames[new Date(bestDay.date + 'T12:00:00').getDay()]} \u2014 stress ${bestDay.stress}/10` : `Stress ${bestDay.stress}/10`}
                  </Text>
                </View>
              </View>
            )}
            {stressAvg != null && (
              <View style={[s.insightRow, { borderBottomWidth: 0 }]}>
                <View style={[s.insightIcon, { backgroundColor: colors.goldSoft }]}>
                  <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }}>~</Text>
                </View>
                <View style={s.insightContent}>
                  <Text style={s.insightTitle}>7-day average</Text>
                  <Text style={s.insightSub}>{stressAvg.toFixed(1)}/10 stress</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Evening reflections — show how the loop is closing */}
        {recentReflections.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Evenings</Text>
            <Text style={s.cardSub}>Last {recentReflections.length} reflections</Text>
            <View style={s.reflectionRow}>
              <View style={s.reflectionStat}>
                <Text style={[s.reflectionValue, { color: colors.success }]}>{reflectionCounts.better}</Text>
                <Text style={s.reflectionLabel}>Better</Text>
              </View>
              <View style={s.reflectionStat}>
                <Text style={[s.reflectionValue, { color: colors.muted }]}>{reflectionCounts.same}</Text>
                <Text style={s.reflectionLabel}>Same</Text>
              </View>
              <View style={s.reflectionStat}>
                <Text style={[s.reflectionValue, { color: colors.error }]}>{reflectionCounts.harder}</Text>
                <Text style={s.reflectionLabel}>Harder</Text>
              </View>
            </View>
          </View>
        )}

        {/* Stress trend chart */}
        {chartTrend.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Stress trend</Text>
            <Text style={s.cardSub}>Last {chartTrend.length} days</Text>
            <View style={s.chartWrap}>
              {chartTrend.map((t, i) => {
                const maxHeight = 80;
                const stress = t.stress ?? 0;
                const height = Math.max(6, (stress / 10) * maxHeight);
                const isBest = minStress != null && stress === minStress;
                // Single cohesive palette: muted gold scaled by stress, bright gold for best day
                const opacity = 0.35 + Math.min(1, stress / 10) * 0.55;
                const barColor = isBest ? colors.gold : `rgba(196,168,108,${opacity.toFixed(2)})`;
                const dayLabel = t.date ? dayInitials[new Date(t.date + 'T12:00:00').getDay()] : '';
                return (
                  <View key={i} style={s.chartCol}>
                    <View style={[s.chartBar, { height, backgroundColor: barColor }]} />
                    <Text style={[s.chartNum, isBest && { color: colors.gold, fontWeight: '700' }]}>{stress}</Text>
                    <Text style={s.chartDay}>{dayLabel}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Empty / Error state */}
        {trend.length === 0 && (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>{error ? 'Could not load' : 'No data yet'}</Text>
            <Text style={s.emptySub}>
              {error
                ? 'Check your connection and try again.'
                : 'Check in daily to start seeing your stress trend and insights.'}
            </Text>
            {error && (
              <TouchableOpacity
                style={s.retryBtn}
                onPress={async () => {
                  setLoading(true);
                  setError(false);
                  try {
                    const res = await api.progress();
                    setData(res?.progress || null);
                  } catch {
                    setError(true);
                  }
                  setLoading(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function buildStoryText({ daysActive, streak, stressChange, stressAvg, recentAvg, totalSessions, bestDay, dayNames }) {
  const parts = [];

  if (daysActive <= 3) {
    parts.push(`You're ${daysActive} days in. This is where the foundation gets built.`);
  } else if (daysActive <= 7) {
    parts.push(`${daysActive} days of showing up. Your body is starting to notice the pattern.`);
  } else if (daysActive <= 14) {
    parts.push(`${daysActive} days. Most people quit by now \u2014 you didn't.`);
  } else if (daysActive <= 30) {
    parts.push(`${daysActive} days of cortisol regulation. This is becoming part of who you are.`);
  } else {
    parts.push(`${daysActive} days. You've built a real practice.`);
  }

  if (stressChange !== null) {
    if (stressChange > 1) {
      parts.push(`Your stress has dropped ${stressChange.toFixed(1)} points this week. That's not luck \u2014 that's the compound effect of what you've been doing.`);
    } else if (stressChange > 0) {
      parts.push(`Stress is trending down slightly. Small shifts add up.`);
    } else if (stressChange < -1) {
      parts.push(`Stress went up this week. That's okay \u2014 tomorrow's plan will adapt.`);
    }
  } else if (recentAvg !== null) {
    if (recentAvg <= 4) {
      parts.push(`Your recent stress levels are looking solid. Keep doing what's working.`);
    } else if (recentAvg >= 7) {
      parts.push(`It's been a tough stretch. The plan is adjusting to meet you where you are.`);
    }
  }

  if (totalSessions > 0 && daysActive > 3) {
    parts.push(totalSessions === 1
      ? `You've internalized 1 thing so far. One real shift adds up.`
      : `You've internalized ${totalSessions} things so far. Each one is a small rewire.`);
  }

  return parts.join(' ');
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  heading: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 20 },

  // Goal
  goalCard: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  goalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  goalText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },

  // Story
  storyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  storyText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
  },

  // AI Insight
  insightCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  insightLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  insightText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
  },

  // Summary row
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
  },
  summaryValue: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 2 },
  summaryLabel: { fontSize: 11, color: colors.dim, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardSub: { fontSize: 12, color: colors.dim, marginBottom: 16 },

  // Insights rows
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  insightIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  insightContent: { flex: 1 },
  insightTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  insightSub: { fontSize: 12, color: colors.muted, marginTop: 1 },

  // Reflections
  reflectionRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  reflectionStat: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reflectionValue: { fontSize: 22, fontWeight: '700', marginBottom: 2 },
  reflectionLabel: { fontSize: 11, color: colors.dim, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Chart
  chartWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110, paddingTop: 8 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: { width: '80%', borderRadius: 3, minHeight: 6 },
  chartNum: { fontSize: 9, color: colors.dim, marginTop: 4 },
  chartDay: { fontSize: 9, color: colors.dim, marginTop: 1 },

  // Empty
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 16,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  retryText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
});
