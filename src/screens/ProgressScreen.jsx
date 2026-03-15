import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { api } from '../api';
import { useAuthStore } from '../store/authStore';

export default function ProgressScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const streak = useAuthStore(s => s.streak);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.progress();
        setData(res?.progress || null);
      } catch {}
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

  const trend = data?.stressTrend || [];
  const consistency = data?.consistency || {};
  const stressAvg = data?.stressAvg7;
  const totalSessions = (consistency.movementCompleted || 0) + (consistency.resetsCompleted || 0);

  // Calculate insights
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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.heading}>Progress</Text>

        {/* Summary cards row */}
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{consistency.checkinDays || 0}</Text>
            <Text style={s.summaryLabel}>Days</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{totalSessions}</Text>
            <Text style={s.summaryLabel}>Sessions</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryValue}>{streak || 0}</Text>
            <Text style={s.summaryLabel}>Streak</Text>
          </View>
        </View>

        {/* Insights card */}
        {(stressChange !== null || bestDay) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Insights</Text>
            {stressChange !== null && (
              <View style={s.insightRow}>
                <View style={[s.insightIcon, { backgroundColor: stressChange > 0 ? 'rgba(122,173,122,0.15)' : 'rgba(201,122,122,0.15)' }]}>
                  <Text style={{ color: stressChange > 0 ? '#7aad7a' : '#c97a7a', fontSize: 16, fontWeight: '700' }}>
                    {stressChange > 0 ? '↓' : '↑'}
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
                <View style={[s.insightIcon, { backgroundColor: 'rgba(196,168,108,0.15)' }]}>
                  <Text style={{ color: colors.gold, fontSize: 14, fontWeight: '700' }}>★</Text>
                </View>
                <View style={s.insightContent}>
                  <Text style={s.insightTitle}>Best day</Text>
                  <Text style={s.insightSub}>
                    {bestDay.date ? `${dayNames[new Date(bestDay.date + 'T12:00:00').getDay()]} — stress ${bestDay.stress}/10` : `Stress ${bestDay.stress}/10`}
                  </Text>
                </View>
              </View>
            )}
            {stressAvg != null && (
              <View style={s.insightRow}>
                <View style={[s.insightIcon, { backgroundColor: 'rgba(196,168,108,0.08)' }]}>
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

        {/* Stress trend chart */}
        {trend.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Stress trend</Text>
            <Text style={s.cardSub}>Last {Math.min(trend.length, 14)} days</Text>
            <View style={s.chartWrap}>
              {trend.slice(-14).map((t, i) => {
                const maxHeight = 80;
                const height = Math.max(6, ((t.stress || 0) / 10) * maxHeight);
                const barColor = t.stress > 7 ? '#c97a7a' : t.stress > 4 ? colors.gold : '#7aad7a';
                const dayLabel = t.date ? dayNames[new Date(t.date + 'T12:00:00').getDay()]?.[0] : '';
                return (
                  <View key={i} style={s.chartCol}>
                    <View style={[s.chartBar, { height, backgroundColor: barColor }]} />
                    <Text style={s.chartNum}>{t.stress}</Text>
                    <Text style={s.chartDay}>{dayLabel}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Activity breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Activity</Text>
          <View style={s.activityRow}>
            <View style={s.activityItem}>
              <Text style={s.activityValue}>{consistency.checkinDays || 0}</Text>
              <Text style={s.activityLabel}>Check-ins</Text>
            </View>
            <View style={s.activityDivider} />
            <View style={s.activityItem}>
              <Text style={s.activityValue}>{consistency.movementCompleted || 0}</Text>
              <Text style={s.activityLabel}>Sessions done</Text>
            </View>
            <View style={s.activityDivider} />
            <View style={s.activityItem}>
              <Text style={s.activityValue}>{consistency.resetsCompleted || 0}</Text>
              <Text style={s.activityLabel}>Resets done</Text>
            </View>
          </View>
        </View>

        {/* Empty state */}
        {trend.length === 0 && (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>No data yet</Text>
            <Text style={s.emptySub}>Check in daily to start seeing your stress trend and insights.</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 100 },

  heading: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 24 },

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

  // Insights
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

  // Chart
  chartWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110, paddingTop: 8 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: { width: '80%', borderRadius: 3, minHeight: 6 },
  chartNum: { fontSize: 9, color: colors.dim, marginTop: 4 },
  chartDay: { fontSize: 9, color: colors.dim, marginTop: 1 },

  // Activity
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8 },
  activityItem: { flex: 1, alignItems: 'center' },
  activityValue: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 2 },
  activityLabel: { fontSize: 11, color: colors.dim },
  activityDivider: { width: 1, height: 30, backgroundColor: colors.line },

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
});
