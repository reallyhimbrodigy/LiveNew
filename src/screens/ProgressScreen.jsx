import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { api } from '../api';

export default function ProgressScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text style={s.logo}>LiveNew</Text>
        <Text style={s.heading}>Your Progress</Text>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>{consistency.checkinDays || 0}</Text>
            <Text style={s.statLabel}>Days</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{(consistency.movementCompleted || 0) + (consistency.resetsCompleted || 0)}</Text>
            <Text style={s.statLabel}>Sessions</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{stressAvg != null ? stressAvg.toFixed(1) : '—'}</Text>
            <Text style={s.statLabel}>Avg Stress</Text>
          </View>
        </View>

        {/* Stress history */}
        {trend.length > 0 && (
          <View style={s.trendWrap}>
            <Text style={s.sectionTitle}>Stress trend</Text>
            <View style={s.trendRow}>
              {trend.slice(-14).map((t, i) => {
                const height = Math.max(8, (t.stress || 0) * 6);
                return (
                  <View key={i} style={s.trendCol}>
                    <View style={[s.trendBar, { height, backgroundColor: t.stress > 7 ? '#c97a7a' : t.stress > 4 ? colors.gold : '#7aad7a' }]} />
                    <Text style={s.trendLabel}>{t.stress || ''}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {trend.length === 0 && (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>Check in daily to see your stress trend.</Text>
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

  logo: { fontSize: 20, fontWeight: '500', color: colors.text, letterSpacing: 1, marginBottom: 20 },
  heading: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 24 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 4 },
  statLabel: { fontSize: 11, color: colors.dim, textTransform: 'uppercase', letterSpacing: 0.5 },

  trendWrap: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.dim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 80 },
  trendCol: { flex: 1, alignItems: 'center' },
  trendBar: { width: '100%', borderRadius: 3, minHeight: 8 },
  trendLabel: { fontSize: 9, color: colors.dim, marginTop: 4 },

  emptyWrap: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: colors.muted, fontSize: 15 },
});
