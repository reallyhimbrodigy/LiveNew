import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import IrisSignature from '../components/IrisSignature';
import Halo from '../components/Halo';
import AuraHalo from '../components/AuraHalo';
import StandingCard from '../components/StandingCard';
import { api } from '../api';
import { useAuthStore, useIsPremium } from '../store/authStore';
import {
  GEMS,
  earnedGems,
  isEarned,
  nextGem,
  gemProgress,
  tierColor,
  rarityPctFor,
  formatRarity,
} from '../domain/gems';
import { AURAS, isAuraEarned } from '../domain/auras';

const PROGRESS_CACHE_KEY = 'livenew:progress_cache_v1';

// Format a 'YYYY-MM-DD' string to e.g. "Jun 9, 2026"
function formatGemDate(iso) {
  if (!iso) return null;
  try {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return null;
  }
}

export default function ProgressScreen() {
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const navigation = useNavigation();
  const isPremium = useIsPremium();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');
  const [selectedGem, setSelectedGem] = useState(null);
  const [selectedAura, setSelectedAura] = useState(null);
  const streak = useAuthStore(s => s.streak);
  const maxStreak = useAuthStore(s => s.maxStreak);
  const gemEarnedAt = useAuthStore(s => s.gemEarnedAt);
  const haloStats = useAuthStore(s => s.haloStats);

  // Stale-while-revalidate: render last-cached payload instantly, refresh in background.
  // Eliminates the multi-second spinner on every Progress tab open.
  const refresh = async () => {
    try {
      const res = await api.progress();
      const next = res?.progress || null;
      setData(next);
      setError(false);
      setErrorDetail('');
      if (next) {
        try { await AsyncStorage.setItem(PROGRESS_CACHE_KEY, JSON.stringify(next)); } catch {}
      }
    } catch (err) {
      setError(true);
      // Build a compact human-readable detail string with everything we
      // know: HTTP status if available, error code, message. Shown inline
      // so users can screenshot it and tell us exactly what's failing.
      const parts = [];
      if (err?.status) parts.push(`HTTP ${err.status}`);
      if (err?.code) parts.push(err.code);
      if (err?.message && err.message !== err.code) parts.push(err.message.slice(0, 60));
      const detail = parts.join(' · ') || 'unknown';
      setErrorDetail(detail);
      // eslint-disable-next-line no-console
      console.warn('[PROGRESS] fetch failed:', detail);
    }
    setLoading(false);
  };

  // Initial mount: hydrate from cache, then refresh.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(PROGRESS_CACHE_KEY);
        if (cached && mounted) {
          setData(JSON.parse(cached));
          setLoading(false);
        }
      } catch {}
      if (mounted) refresh();
    })();
    return () => { mounted = false; };
  }, []);

  // Auto-retry on tab focus. Without this, the first failed fetch sticks
  // the screen on "Iris is offline" forever (since lazy:false means the
  // screen never unmounts/remounts). Tab focus = the user is looking at
  // Progress = the right moment to re-try without a manual Retry tap.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  const rawTrend = data?.stressTrend || [];
  const trend = [...rawTrend].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const consistency = data?.consistency || {};
  const stressAvg = data?.stressAvg7;
  const totalSessions = (consistency.movementCompleted || 0) + (consistency.resetsCompleted || 0) + (consistency.winddownsCompleted || 0);
  const weeklySummary = data?.weeklySummary || null;
  const insight = data?.insight || null;
  const reflections = Array.isArray(data?.reflections) ? data.reflections : [];
  const behaviorProfile = data?.behaviorProfile || null;

  // Reflection breakdown for last 7 days
  const recentReflections = reflections.slice(-7);
  const reflectionCounts = recentReflections.reduce((acc, r) => {
    acc[r.feeling] = (acc[r.feeling] || 0) + 1;
    return acc;
  }, { better: 0, same: 0, harder: 0 });

  // Pattern callouts — "what we've noticed" lines derived from the behavior
  // profile. Only show meaningful ones, and only when there's enough data.
  const patternCallouts = (() => {
    if (!behaviorProfile) return [];
    const out = [];
    const { completionsByType = {}, totalItemsDoneLast14 = 0, daysActive = 0, checkInsLast14 = 0 } = behaviorProfile;
    const TYPE_LABEL = { breathe: 'Breath work', food: 'Food items', mindset: 'Mindset shifts', habit: 'Habit nudges' };
    if (daysActive < 3) return out;
    if (totalItemsDoneLast14 >= 4) {
      const sorted = Object.entries(completionsByType).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      if (top && top[1] >= 3) {
        out.push(`${TYPE_LABEL[top[0]]} stick — you've internalized ${top[1]} of them.`);
      }
      if (bottom && bottom[1] === 0 && totalItemsDoneLast14 >= 6) {
        out.push(`${TYPE_LABEL[bottom[0]]} aren't landing. I'm easing off them.`);
      }
    }
    if (checkInsLast14 >= 5) {
      out.push(`Showing up ${checkInsLast14} of the last 14 days. The plan is shaping around you.`);
    } else if (checkInsLast14 >= 3 && daysActive >= 3) {
      out.push(`${daysActive} days in. Patterns will sharpen as you keep checking in.`);
    }
    return out.slice(0, 3);
  })();

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

  // Gems — derived from maxStreak (historical best)
  const earnedCount = earnedGems(maxStreak).length;
  const gemNext = nextGem(maxStreak);
  const { daysToGo, fraction } = gemProgress(streak, maxStreak);

  // Auras context — premium-gated collectible tier
  const allHalosEarned = earnedGems(maxStreak).length === GEMS.length;
  const auraCtx = useMemo(
    () => ({ isPremium, maxStreak, allHalosEarned }),
    [isPremium, maxStreak, allHalosEarned]
  );

  // Week-over-week outcomes — REAL deltas the user can screenshot.
  // Without this, the user has to trust on faith that the app is working.
  const outcomes = useMemo(() => {
    if (trend.length < 5) return null; // not enough data yet
    // Stress avg this week vs last
    const stressDelta = (recentAvg != null && olderAvg != null)
      ? Math.round((olderAvg - recentAvg) * 10) / 10
      : null;
    // Reflection breakdown this week vs last
    const sortedReflections = [...reflections].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const recentRefl = sortedReflections.slice(-7);
    const olderRefl = sortedReflections.slice(-14, -7);
    const countOf = (arr, key) => arr.filter((r) => r.feeling === key).length;
    const recentBetter = countOf(recentRefl, 'better');
    const recentHarder = countOf(recentRefl, 'harder');
    const olderBetter = countOf(olderRefl, 'better');
    const olderHarder = countOf(olderRefl, 'harder');
    const reflectionShift = (recentBetter - recentHarder) - (olderBetter - olderHarder);
    // Days active this week vs last
    const allDays = trend.map((t) => t.date).filter(Boolean);
    const last7Days = new Set(allDays.slice(-7));
    const prior7Days = new Set(allDays.slice(-14, -7));
    return {
      stressDelta,
      recentAvg,
      olderAvg,
      recentBetter,
      recentHarder,
      olderBetter,
      olderHarder,
      reflectionShift,
      daysThisWeek: last7Days.size,
      daysLastWeek: prior7Days.size,
      hasReflectionData: sortedReflections.length >= 3,
    };
  }, [trend, recentAvg, olderAvg, reflections]);

  // Iris-voiced one-sentence summary of the week
  const outcomesSummary = useMemo(() => {
    if (!outcomes) return null;
    const parts = [];
    if (outcomes.stressDelta != null && Math.abs(outcomes.stressDelta) >= 0.5) {
      if (outcomes.stressDelta > 0) parts.push(`stress down ${outcomes.stressDelta.toFixed(1)}`);
      else parts.push(`stress up ${Math.abs(outcomes.stressDelta).toFixed(1)}`);
    }
    if (outcomes.hasReflectionData && outcomes.reflectionShift !== 0) {
      if (outcomes.reflectionShift > 0) parts.push("more 'better' days than the week before");
      else parts.push("more 'harder' days than the week before");
    }
    if (outcomes.daysThisWeek > outcomes.daysLastWeek) {
      parts.push(`showed up ${outcomes.daysThisWeek - outcomes.daysLastWeek} more day${outcomes.daysThisWeek - outcomes.daysLastWeek === 1 ? '' : 's'}`);
    }
    if (parts.length === 0) return "Steady week — held the line. That counts.";
    return "This week vs last: " + parts.join(', ') + ".";
  }, [outcomes]);

  // Chart slice (trend is already sorted chronologically asc)
  const chartTrend = trend.slice(-14);
  const minStress = chartTrend.length > 0
    ? Math.min(...chartTrend.map(t => t.stress ?? 999))
    : null;

  if (loading && !data) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.headerRow}>
          <Text style={s.heading}>Progress</Text>
          <IrisSignature />
        </View>

        {/* Your Standing — competitive top-X% flex, derived from highest earned halo */}
        <StandingCard />

        {/* Your Halos — streak collection, replaces milestone/unlock cards */}
        <View style={s.gemsCard}>
          {/* Header row */}
          <View style={s.gemsHeaderRow}>
            <Text style={s.gemsTitle}>Your halos</Text>
            <Text style={s.gemsCount}>{earnedCount}/{GEMS.length}</Text>
          </View>

          {/* Next-gem progress */}
          {gemNext !== null ? (
            <View style={s.gemsNextWrap}>
              <Text style={s.gemsNextLabel}>
                Next: {gemNext.name} · {daysToGo} {daysToGo === 1 ? 'day' : 'days'} to go
              </Text>
              <View style={s.gemsTrack}>
                <View style={[s.gemsFill, { width: `${Math.round(fraction * 100)}%` }]} />
              </View>
            </View>
          ) : (
            <Text style={s.gemsAllDone}>All halos earned.</Text>
          )}

          {/* Gem grid */}
          <View style={s.gemsGrid}>
            {GEMS.map((g) => {
              const earned = isEarned(g.id, maxStreak);
              return (
                <View key={g.id} style={s.gemCell}>
                  <Halo
                    gem={g}
                    earned={earned}
                    size={56}
                    onPress={() => setSelectedGem(g)}
                  />
                  <Text style={[s.gemCellName, !earned && { color: colors.dim }]}>
                    {g.name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Gem detail modal */}
        {selectedGem !== null && (
          <Modal
            visible={selectedGem !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedGem(null)}
          >
            <Pressable
              style={s.gemModalOverlay}
              onPress={() => setSelectedGem(null)}
            >
              <Pressable style={s.gemModalCard} onPress={() => {}}>
                {/* Large halo */}
                <View style={s.gemModalGemWrap}>
                  <Halo
                    gem={selectedGem}
                    earned={isEarned(selectedGem.id, maxStreak)}
                    size={120}
                  />
                </View>

                {/* Name + tier */}
                <Text style={s.gemModalName}>{selectedGem.name}</Text>
                <Text style={[s.gemModalTier, { color: tierColor(selectedGem.tier) }]}>
                  {selectedGem.tier}
                </Text>

                {/* Rarity */}
                <Text style={s.gemModalRarity}>
                  Held by ~{formatRarity(rarityPctFor(selectedGem, haloStats))}% of members
                </Text>

                {/* Earned / locked status */}
                {isEarned(selectedGem.id, maxStreak) ? (
                  <Text style={s.gemModalStatus}>
                    {gemEarnedAt && gemEarnedAt[selectedGem.id]
                      ? `Earned ${formatGemDate(gemEarnedAt[selectedGem.id])}`
                      : 'Earned'}
                  </Text>
                ) : (
                  <Text style={s.gemModalStatus}>
                    Reach a {selectedGem.day}-day streak to earn this halo.
                  </Text>
                )}

                {/* Flavor */}
                <Text style={s.gemModalFlavor}>{selectedGem.flavor}</Text>

                {/* Close */}
                <Pressable
                  style={({ pressed }) => [s.gemModalClose, pressed && { opacity: 0.85 }]}
                  onPress={() => setSelectedGem(null)}
                >
                  <Text style={s.gemModalCloseText}>Close</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        )}

        {/* ── Auras — premium-exclusive iridescent collectible tier ────────── */}
        <View style={s.aurasCard}>
          {/* Header */}
          <View style={s.aurasHeaderRow}>
            <View style={s.aurasHeaderLeft}>
              <Text style={s.aurasTitle}>Auras</Text>
              <View style={s.premiumBadge}>
                <Text style={s.premiumBadgeText}>PREMIUM</Text>
              </View>
            </View>
          </View>

          {/* Tagline */}
          <Text style={s.aurasTagline}>
            {isPremium
              ? 'Exclusive auras — alive, iridescent, yours.'
              : 'Premium-only. The rarest things you can hold.'}
          </Text>

          {/* Aura grid */}
          <View style={s.aurasGrid}>
            {AURAS.map((a) => {
              const earned = isAuraEarned(a.id, auraCtx);
              return (
                <View key={a.id} style={s.auraCell}>
                  <AuraHalo
                    aura={a}
                    earned={earned}
                    size={64}
                    onPress={() => {
                      if (!isPremium) {
                        navigation.navigate('Paywall');
                      } else {
                        setSelectedAura(a);
                      }
                    }}
                  />
                  <Text style={[s.auraCellName, !earned && { color: colors.dim }]}>
                    {a.name}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Non-premium CTA */}
          {!isPremium && (
            <Pressable
              style={({ pressed }) => [s.aurasUnlockBtn, pressed && { opacity: 0.85 }]}
              onPress={() => navigation.navigate('Paywall')}
            >
              <Text style={s.aurasUnlockText}>Unlock Auras</Text>
            </Pressable>
          )}
        </View>

        {/* Aura detail modal */}
        {selectedAura !== null && (
          <Modal
            visible={selectedAura !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedAura(null)}
          >
            <Pressable
              style={s.gemModalOverlay}
              onPress={() => setSelectedAura(null)}
            >
              <Pressable style={s.auraModalCard} onPress={() => {}}>
                {/* Large aura halo */}
                <View style={s.gemModalGemWrap}>
                  <AuraHalo
                    aura={selectedAura}
                    earned={isAuraEarned(selectedAura.id, auraCtx)}
                    size={150}
                  />
                </View>

                {/* Name */}
                <Text style={s.gemModalName}>{selectedAura.name}</Text>

                {/* Tier badge */}
                <View style={s.auraModalTierBadge}>
                  <Text style={s.auraModalTierText}>PREMIUM AURA</Text>
                </View>

                {/* Condition */}
                <Text style={s.auraModalCondition}>{selectedAura.condition}</Text>

                {/* Description */}
                <Text style={s.gemModalFlavor}>{selectedAura.description}</Text>

                {/* Status */}
                {isAuraEarned(selectedAura.id, auraCtx) ? (
                  <Text style={[s.gemModalStatus, { color: selectedAura.palette[2] }]}>
                    Earned
                  </Text>
                ) : isPremium ? (
                  <Text style={s.gemModalStatus}>
                    {selectedAura.condition}
                  </Text>
                ) : (
                  <>
                    <Text style={s.gemModalStatus}>Premium — unlock to earn.</Text>
                    <Pressable
                      style={({ pressed }) => [s.auraPaywallBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => { setSelectedAura(null); navigation.navigate('Paywall'); }}
                    >
                      <Text style={s.auraPaywallBtnText}>Go Premium</Text>
                    </Pressable>
                  </>
                )}

                {/* Close */}
                <Pressable
                  style={({ pressed }) => [s.gemModalClose, { marginTop: 16 }, pressed && { opacity: 0.85 }]}
                  onPress={() => setSelectedAura(null)}
                >
                  <Text style={s.gemModalCloseText}>Close</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        )}

        {/* Stale-cache warning when refresh failed but we're rendering
            cached data. Without this, the user thinks the numbers are
            current. */}
        {error && trend.length > 0 && (
          <View style={s.staleBanner}>
            <Text style={s.staleBannerText}>
              Couldn't refresh — showing last data Iris has on you.
            </Text>
          </View>
        )}

        {/* Weekly outcomes — REAL deltas so the user can feel the app working. */}
        {outcomes && outcomesSummary ? (
          <View style={s.outcomesCard}>
            <View style={s.outcomesHeader}>
              <IrisSignature />
              <Text style={s.outcomesHeaderSuffix}>this week vs last</Text>
            </View>
            <Text style={s.outcomesSummary}>{outcomesSummary}</Text>
            <View style={s.outcomesGrid}>
              {outcomes.stressDelta != null && Math.abs(outcomes.stressDelta) >= 0.3 ? (
                <View style={s.outcomeStat}>
                  <Text style={[s.outcomeStatNum, { color: outcomes.stressDelta > 0 ? colors.success : colors.error }]}>
                    {outcomes.stressDelta > 0 ? `−${outcomes.stressDelta.toFixed(1)}` : `+${Math.abs(outcomes.stressDelta).toFixed(1)}`}
                  </Text>
                  <Text style={s.outcomeStatLabel}>stress avg</Text>
                </View>
              ) : null}
              {outcomes.hasReflectionData ? (
                <View style={s.outcomeStat}>
                  <Text style={s.outcomeStatNum}>
                    {outcomes.recentBetter}<Text style={s.outcomeStatNumDim}>/{outcomes.recentBetter + outcomes.recentHarder || '0'}</Text>
                  </Text>
                  <Text style={s.outcomeStatLabel}>"better" days</Text>
                </View>
              ) : null}
              <View style={s.outcomeStat}>
                <Text style={s.outcomeStatNum}>{outcomes.daysThisWeek}<Text style={s.outcomeStatNumDim}>/7</Text></Text>
                <Text style={s.outcomeStatLabel}>days active</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* What Iris has noticed — pattern callouts derived from behavior profile */}
        {patternCallouts.length > 0 && (
          <View style={s.noticedCard}>
            <View style={s.noticedHeader}>
              <IrisSignature />
              <Text style={s.noticedHeaderSuffix}>noticed</Text>
            </View>
            {patternCallouts.map((line, i) => (
              <View key={i} style={[s.noticedRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 10, paddingTop: 10 }]}>
                <View style={s.noticedDot} />
                <Text style={s.noticedText}>{line}</Text>
              </View>
            ))}
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

        {/* Iris's weekly read */}
        {insight && (
          <View style={s.insightCard}>
            <View style={s.insightHeader}>
              <IrisSignature />
              <Text style={s.insightHeaderSuffix}>this week</Text>
            </View>
            <Text style={s.insightText}>{insight}</Text>
          </View>
        )}

        {/* Summary tiles — only meaningful once foundation is complete.
            Showing 0 / 0 / 1 on day one reads as "you're not doing well"
            when the truth is the user just signed up. Milestone card carries
            day 1; tiles appear when there's actually a story to tell. */}
        {daysActive >= 3 && (
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
        )}

        {/* Key insights */}
        {(stressChange !== null || bestDay || stressAvg != null) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Insights</Text>
            {stressChange !== null && (
              <View style={s.insightRow}>
                <View style={[s.insightIcon, { backgroundColor: stressChange > 0 ? colors.successBg : colors.errorBg }]}>
                  <Text style={{ color: stressChange > 0 ? colors.success : colors.error, fontSize: 16, fontFamily: fonts.displayBold }}>
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
                  <Text style={{ color: colors.gold, fontSize: 14, fontFamily: fonts.displayBold }}>{'\u2605'}</Text>
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
                  <Text style={{ color: colors.muted, fontSize: 14, fontFamily: fonts.displayBold }}>~</Text>
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
                <Text style={s.reflectionValue}>{reflectionCounts.better}</Text>
                <Text style={s.reflectionLabel}>Better</Text>
              </View>
              <View style={s.reflectionStat}>
                <Text style={s.reflectionValue}>{reflectionCounts.same}</Text>
                <Text style={s.reflectionLabel}>Same</Text>
              </View>
              <View style={s.reflectionStat}>
                <Text style={s.reflectionValue}>{reflectionCounts.harder}</Text>
                <Text style={s.reflectionLabel}>Harder</Text>
              </View>
            </View>
            {recentReflections.length >= 3 && (
              <Text style={s.reflectionInsight}>
                {reflectionCounts.better > reflectionCounts.harder
                  ? 'More “better” days than “harder” this week. The pattern is starting to land.'
                  : reflectionCounts.harder > reflectionCounts.better
                    ? 'A heavier week. Tomorrow’s plan will keep things gentler.'
                    : 'Even split. Pay attention to what shifted on the better days.'}
              </Text>
            )}
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
                    <Text style={[s.chartNum, isBest && { color: colors.gold, fontFamily: fonts.displayBold }]}>{stress}</Text>
                    <Text style={s.chartDay}>{dayLabel}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Day-1 / pre-trend state. Gems section above anchors day one;
            this is a small contextual nudge for the chart area. */}
        {trend.length === 0 && !error && (
          <View style={s.emptyCard}>
            <Text style={s.emptySub}>
              Your stress trend and weekly outcomes appear here as you check in. Show up tomorrow to start the curve.
            </Text>
          </View>
        )}
        {trend.length === 0 && error && (
          <View style={s.emptyCard}>
            <Text style={s.emptySub}>
              Iris is offline for a moment. Keep showing up — your halos are tracked locally.
            </Text>
            {/* Show the actual failure reason so we can diagnose instead of
                guessing. Muted, small, screenshot-able. */}
            {errorDetail ? (
              <Text style={s.emptyDebug}>reason: {errorDetail}</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [s.retryBtn, pressed && { opacity: 0.85 }]}
              onPress={() => { setLoading(true); refresh(); }}
            >
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// One sentence. Pick the most signal-rich fact about today.
// AI insight on Progress carries the rest of the narrative.
function buildStoryText({ daysActive, streak, stressChange, stressAvg, recentAvg, totalSessions, bestDay, dayNames }) {
  if (stressChange !== null && stressChange > 1) {
    return `Stress dropped ${stressChange.toFixed(1)} points this week.`;
  }
  if (stressChange !== null && stressChange < -1) {
    return `Stress climbed this week. Tomorrow adapts.`;
  }
  if (daysActive <= 3) {
    return `Day ${daysActive}. Foundation phase.`;
  }
  if (recentAvg !== null && recentAvg >= 7) {
    return `Stress sitting around ${Math.round(recentAvg)}. Tough stretch.`;
  }
  if (recentAvg !== null && recentAvg <= 4) {
    return `Stress steady around ${Math.round(recentAvg)}. Whatever you're doing, keep going.`;
  }
  return `${daysActive} days in.`;
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
    scroll: { padding: 20, paddingBottom: 100 },

    headerRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 22,
    },
    heading: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      letterSpacing: 0.2,
    },

    // Your Gems card
    gemsCard: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    gemsHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    gemsTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      color: colors.text,
      letterSpacing: 0.1,
    },
    gemsCount: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
    },
    gemsNextWrap: {
      marginBottom: 18,
    },
    gemsNextLabel: {
      fontFamily: fonts.display,
      fontSize: 13,
      color: colors.muted,
      marginBottom: 8,
      letterSpacing: 0.1,
    },
    gemsTrack: {
      height: 3,
      backgroundColor: colors.line,
      borderRadius: 2,
      overflow: 'hidden',
    },
    gemsFill: {
      height: 3,
      backgroundColor: colors.gold,
      borderRadius: 2,
    },
    gemsAllDone: {
      fontFamily: fonts.italic,
      fontSize: 14,
      color: colors.gold,
      marginBottom: 18,
      letterSpacing: 0.1,
    },
    gemsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -6,
    },
    gemCell: {
      width: '25%',
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingVertical: 8,
    },
    gemCellName: {
      fontFamily: fonts.body,
      fontSize: 9,
      color: colors.text,
      textAlign: 'center',
      marginTop: 5,
      letterSpacing: 0.2,
    },

    // Gem detail modal
    gemModalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 28,
    },
    gemModalCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 28,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.goldBorder,
      alignItems: 'center',
    },
    gemModalGemWrap: {
      marginBottom: 16,
    },
    gemModalName: {
      fontFamily: fonts.displayBold,
      fontSize: 22,
      color: colors.text,
      letterSpacing: 0.2,
      textAlign: 'center',
      marginBottom: 4,
    },
    gemModalTier: {
      fontFamily: fonts.displaySemibold,
      fontSize: 12,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      marginBottom: 12,
    },
    gemModalRarity: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.muted,
      textAlign: 'center',
      marginBottom: 8,
    },
    gemModalStatus: {
      fontFamily: fonts.display,
      fontSize: 14,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 12,
      lineHeight: 20,
    },
    gemModalFlavor: {
      fontFamily: fonts.italic,
      fontSize: 14,
      color: colors.muted,
      textAlign: 'center',
      lineHeight: 21,
      marginBottom: 22,
      paddingHorizontal: 4,
    },
    gemModalClose: {
      backgroundColor: colors.gold,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 36,
    },
    gemModalCloseText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: '#1a1612',
      letterSpacing: 0.4,
    },

    // Auras section
    aurasCard: {
      backgroundColor: 'rgba(130,80,180,0.06)',
      borderWidth: 1,
      borderColor: 'rgba(180,140,220,0.22)',
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    aurasHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    aurasHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    aurasTitle: {
      fontFamily: fonts.displaySemibold,
      fontSize: 16,
      color: colors.text,
      letterSpacing: 0.1,
    },
    premiumBadge: {
      backgroundColor: 'rgba(160,100,220,0.18)',
      borderRadius: 5,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderWidth: 0.8,
      borderColor: 'rgba(180,130,240,0.35)',
    },
    premiumBadgeText: {
      fontFamily: fonts.displayBold,
      fontSize: 9,
      color: '#c890f0',
      letterSpacing: 1.1,
    },
    aurasTagline: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
      marginBottom: 16,
      letterSpacing: 0.1,
      lineHeight: 19,
    },
    aurasGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -6,
    },
    auraCell: {
      width: '20%',
      alignItems: 'center',
      paddingHorizontal: 2,
      paddingVertical: 8,
    },
    auraCellName: {
      fontFamily: fonts.body,
      fontSize: 8,
      color: colors.text,
      textAlign: 'center',
      marginTop: 5,
      letterSpacing: 0.2,
    },
    aurasUnlockBtn: {
      marginTop: 14,
      backgroundColor: 'rgba(160,100,220,0.15)',
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: 'center',
      borderWidth: 0.8,
      borderColor: 'rgba(180,130,240,0.3)',
    },
    aurasUnlockText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: '#c890f0',
      letterSpacing: 0.4,
    },
    // Aura detail modal
    auraModalCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 28,
      width: '100%',
      borderWidth: 1,
      borderColor: 'rgba(180,130,240,0.3)',
      alignItems: 'center',
    },
    auraModalTierBadge: {
      backgroundColor: 'rgba(160,100,220,0.18)',
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 3,
      marginBottom: 10,
      borderWidth: 0.8,
      borderColor: 'rgba(180,130,240,0.35)',
    },
    auraModalTierText: {
      fontFamily: fonts.displayBold,
      fontSize: 10,
      color: '#c890f0',
      letterSpacing: 1.3,
    },
    auraModalCondition: {
      fontFamily: fonts.displaySemibold,
      fontSize: 13,
      color: colors.muted,
      textAlign: 'center',
      marginBottom: 10,
      letterSpacing: 0.2,
    },
    auraPaywallBtn: {
      marginTop: 12,
      backgroundColor: 'rgba(160,100,220,0.18)',
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderWidth: 0.8,
      borderColor: 'rgba(180,130,240,0.35)',
    },
    auraPaywallBtnText: {
      fontFamily: fonts.displaySemibold,
      fontSize: 14,
      color: '#c890f0',
      letterSpacing: 0.4,
    },

    outcomesCard: {
      backgroundColor: colors.goldSoft,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 14,
      padding: 16,
      marginBottom: 16,
    },
    outcomesHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 10,
    },
    outcomesHeaderSuffix: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
    },
    outcomesSummary: {
      fontFamily: fonts.italic,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
      letterSpacing: 0.1,
      marginBottom: 14,
    },
    outcomesGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    outcomeStat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      backgroundColor: colors.surface,
      borderRadius: 10,
    },
    outcomeStatNum: {
      fontFamily: fonts.accentBold,
      fontSize: 22,
      color: colors.text,
      letterSpacing: 0.2,
    },
    outcomeStatNumDim: {
      fontSize: 14,
      color: colors.muted,
    },
    outcomeStatLabel: {
      fontFamily: fonts.displaySemibold,
      fontSize: 10,
      color: colors.muted,
      letterSpacing: 1.2,
      marginTop: 2,
      textTransform: 'uppercase',
    },
    staleBanner: {
      backgroundColor: colors.errorBg,
      borderWidth: 1,
      borderColor: colors.errorBorder,
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    staleBannerText: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.error,
      letterSpacing: 0.1,
    },
    noticedHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 12,
    },
    noticedHeaderSuffix: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
      letterSpacing: 0.2,
    },
    insightHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 10,
    },
    insightHeaderSuffix: {
      fontFamily: fonts.italic,
      fontSize: 13,
      color: colors.muted,
      letterSpacing: 0.2,
    },

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
      fontFamily: fonts.displayBold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 2,
      marginBottom: 8,
    },
    goalText: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: colors.text,
      lineHeight: 24,
      letterSpacing: 0.1,
    },

    // What we've noticed — pattern callouts
    noticedCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.goldBorder,
      borderRadius: 14,
      padding: 18,
      marginBottom: 16,
    },
    noticedLabel: {
      fontFamily: fonts.displayBold,
      fontSize: 10,
      color: colors.gold,
      letterSpacing: 1.6,
      marginBottom: 12,
    },
    noticedRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    noticedDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.gold,
      marginTop: 9,
    },
    noticedText: {
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
      letterSpacing: 0.1,
      flex: 1,
    },

    // Story
    storyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      padding: 20,
      marginBottom: 16,
    },
    storyText: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: colors.text,
      lineHeight: 26,
      letterSpacing: 0.1,
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
      fontFamily: fonts.displayBold,
      fontSize: 11,
      color: colors.dim,
      letterSpacing: 1.5,
      marginBottom: 8,
    },
    insightText: {
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.text,
      lineHeight: 24,
      letterSpacing: 0.1,
    },

    // Summary row
    summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    summaryCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      paddingVertical: 22,
      alignItems: 'center',
    },
    summaryValue: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.text,
      marginBottom: 4,
      letterSpacing: 0.2,
    },
    summaryLabel: { fontFamily: fonts.displaySemibold, fontSize: 10, color: colors.dim, textTransform: 'uppercase', letterSpacing: 1.2 },

    // Cards
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      padding: 18,
      marginBottom: 12,
    },
    cardTitle: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text, marginBottom: 4 },
    cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.dim, marginBottom: 16 },

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
    insightTitle: { fontFamily: fonts.displaySemibold, fontSize: 14, color: colors.text },
    insightSub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 1 },

    // Reflections
    reflectionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    reflectionStat: {
      flex: 1,
      backgroundColor: colors.bg,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
    },
    reflectionValue: {
      fontFamily: fonts.displayBold,
      fontSize: 24,
      color: colors.text,
      marginBottom: 2,
    },
    reflectionLabel: { fontFamily: fonts.displaySemibold, fontSize: 10, color: colors.dim, textTransform: 'uppercase', letterSpacing: 1.2 },
    reflectionInsight: {
      fontFamily: fonts.displayItalic,
      fontSize: 13,
      color: colors.muted,
      marginTop: 14,
      lineHeight: 19,
    },

    // Chart
    chartWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110, paddingTop: 8 },
    chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    chartBar: { width: '80%', borderRadius: 3, minHeight: 6 },
    chartNum: { fontFamily: fonts.body, fontSize: 9, color: colors.dim, marginTop: 4 },
    chartDay: { fontFamily: fonts.body, fontSize: 9, color: colors.dim, marginTop: 1 },

    // Empty
    emptyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      padding: 32,
      alignItems: 'center',
    },
    emptyTitle: { fontFamily: fonts.displaySemibold, fontSize: 18, color: colors.text, marginBottom: 8 },
    emptySub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
    emptyDebug: { fontFamily: fonts.body, fontSize: 11, color: colors.dim, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
    retryBtn: {
      marginTop: 16,
      backgroundColor: colors.gold,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 24,
    },
    retryText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 14 },
  });
}
