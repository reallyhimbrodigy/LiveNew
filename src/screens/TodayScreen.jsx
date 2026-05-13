import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, AppState,
  Modal, ActivityIndicator,
  Animated, LayoutAnimation, UIManager, Platform,
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
import { computeScore, scoreBand, getCurrentZoneId, ZONE_ORDER, ZONE_LABELS } from '../utils/score';
import { api } from '../api';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
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

function PressCard({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => {
        if (disabled) return;
        Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
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
  const todayStress = useAuthStore(s => s.todayStress);
  const todaySleep = useAuthStore(s => s.todaySleep);
  const todayEnergy = useAuthStore(s => s.todayEnergy);
  const streak = useAuthStore(s => s.streak);
  const completed = useAuthStore(s => s.completed);
  const reflection = useAuthStore(s => s.reflection);
  const profile = useAuthStore(s => s.profile);
  const skippedDate = useAuthStore(s => s.skippedDate);
  const submitReflection = useAuthStore(s => s.submitReflection);
  const clearSkip = useAuthStore(s => s.clearSkip);
  const stressHistory = useAuthStore(s => s.stressHistory);
  const healthPermission = useAuthStore(s => s.healthPermission);
  const healthSnapshot = useAuthStore(s => s.healthSnapshot);
  const refreshHealthSnapshot = useAuthStore(s => s.refreshHealthSnapshot);

  const [currentZoneId, setCurrentZoneId] = useState(getCurrentZoneId());
  const [showStressRelief, setShowStressRelief] = useState(false);
  const [stressNoted, setStressNoted] = useState(false);
  const [showAllZones, setShowAllZones] = useState(false);
  // Fresh stress-relief content per tap. NOT cached — every open of the
  // modal triggers a new AI generation.
  const [reliefLoading, setReliefLoading] = useState(false);
  const [reliefText, setReliefText] = useState('');
  // Subtle breathing animation on the dot inside the stress button.
  const stressDotOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(stressDotOpacity, { toValue: 0.35, duration: 1400, useNativeDriver: true }),
        Animated.timing(stressDotOpacity, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Refresh "current" zone when app focuses or every minute
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setCurrentZoneId(getCurrentZoneId());
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const interval = setInterval(() => setCurrentZoneId(getCurrentZoneId()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Hydrate plan on mount if needed (or land in empty state)
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
      if (todayPlan && todayDate !== today) {
        useAuthStore.setState({
          todayPlan: null, todayDate: null, completed: {}, reflection: null,
        });
      }
    };
    check();
  }, []);

  useFocusEffect(useCallback(() => {
    setCurrentZoneId(getCurrentZoneId());
  }, []));

  // Build zone lookup
  const zones = Array.isArray(todayPlan?.zones) ? todayPlan.zones : [];
  const zoneById = zones.reduce((acc, z) => { acc[z.id] = z; return acc; }, {});
  const currentZone = zoneById[currentZoneId] || zones[0] || null;

  const goalThread = todayPlan?.goalThread || null;
  const stressRelief = todayPlan?.stressRelief || null;
  const eveningPrompt = todayPlan?.eveningPrompt || null;
  const showEveningReflection = isEvening() && !reflection && zones.length > 0;
  const showStressBtn = !!stressRelief;

  // Score — derived from check-in + behavior + trend, AND HealthKit when available.
  const stressTrend = Array.isArray(stressHistory) ? stressHistory : [];
  const score = computeScore({
    stressLabel: typeof todayStress === 'string' ? todayStress : null,
    sleepQuality: todaySleep,
    energy: todayEnergy,
    stressTrend,
    healthSnapshot,
  });
  const band = scoreBand(score);

  // Refresh the HealthKit snapshot whenever Today gains focus so the score
  // and any health-aware UI stays current. No-op when permission isn't granted.
  useFocusEffect(useCallback(() => {
    if (healthPermission === 'granted') {
      refreshHealthSnapshot().catch(() => {});
    }
  }, [healthPermission]));


  const { dayOfWeek, partOfDay } = getGreetingParts();

  const handleReflection = (feeling) => {
    tapSuccess();
    submitReflection(feeling);
  };

  // Empty / loading / skipped states
  const today = getLocalDateISO();
  if (!todayPlan) {
    if (skippedDate === today || true) {
      // For first-time / skipped / day-roll: show a calm "ready when you are"
      const morning = new Date().getHours() < 12;
      return (
        <SafeAreaView style={s.safe} edges={['top']}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <View style={s.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.greetingDay}>{dayOfWeek.toLowerCase()}</Text>
                <Text style={s.greetingPart}>{partOfDay}</Text>
              </View>
            </View>

            <View style={s.emptyCard}>
              <Text style={s.emptyLabel}>NO PLAN YET</Text>
              <Text style={s.emptyTitle}>{morning ? 'A new day.' : 'Ready when you are.'}</Text>
              <Text style={s.emptyBody}>
                Three taps. We'll calibrate your day around your sleep, your stress, and your energy.
              </Text>
              <Pressable
                style={({ pressed }) => [s.emptyCta, pressed && { opacity: 0.85 }]}
                onPress={async () => {
                  tapSelect();
                  await clearSkip();
                  navigation.replace('StressTap');
                }}
              >
                <Text style={s.emptyCtaText}>Start today</Text>
              </Pressable>
              <Text style={s.emptyHint}>Or browse Progress and Account anytime.</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.centered}><ActivityIndicator size="large" color={colors.gold} /></View>
      </SafeAreaView>
    );
  }

  if (zones.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={[s.centered, { padding: 24 }]}>
          <Text style={s.greeting}>Something went wrong</Text>
          <Text style={s.errorBody}>Today's zones didn't generate properly.</Text>
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

  const currentZoneIndex = ZONE_ORDER.indexOf(currentZoneId);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: showStressBtn ? 140 : 80 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Header — score + greeting + redo */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.greetingDay}>{dayOfWeek.toLowerCase()}</Text>
            <Text style={s.greetingPart}>{partOfDay}</Text>
          </View>
          <View style={s.scoreChip}>
            <Text style={[s.scoreNum, band === 'high' && { color: colors.gold }]}>{score}</Text>
            <Text style={s.scoreLabel}>score</Text>
          </View>
          <Pressable
            onPress={() => { tapSelect(); navigation.replace('StressTap'); }}
            hitSlop={10}
            style={s.redoBtn}
          >
            <Text style={s.redoIcon}>↻</Text>
          </Pressable>
        </View>

        {/* Current zone — hero card */}
        {currentZone && (
          <View style={s.zoneHero}>
            <LinearGradient
              colors={['rgba(196,168,108,0.10)', 'rgba(196,168,108,0.02)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={s.zoneAccent} />
            <View style={s.zoneTopRow}>
              <Text style={s.zoneLabel}>{ZONE_LABELS[currentZoneId] || 'Right now'}</Text>
              <View style={s.nowPill}><View style={s.nowPillDot} /><Text style={s.nowPillText}>NOW</Text></View>
            </View>
            <Text style={s.zoneHeadline}>{currentZone.headline}</Text>
            <Text style={s.zoneBody}>{currentZone.body}</Text>
          </View>
        )}

        {/* Today's arc — visual position + tap to expand */}
        <Pressable
          style={s.arcCard}
          onPress={() => {
            tapLight();
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowAllZones(v => !v);
          }}
        >
          <View style={s.arcHeader}>
            <Text style={s.arcLabel}>TODAY'S ARC</Text>
            <Text style={s.arcChevron}>{showAllZones ? '▾' : '▸'}</Text>
          </View>
          <View style={s.arcRow}>
            {ZONE_ORDER.map((zid, i) => {
              const isCurrent = zid === currentZoneId;
              const isPast = i < currentZoneIndex;
              return (
                <View key={zid} style={s.arcSegment}>
                  <View style={[
                    s.arcDot,
                    isPast && s.arcDotPast,
                    isCurrent && s.arcDotCurrent,
                  ]} />
                  {i < ZONE_ORDER.length - 1 && (
                    <View style={[s.arcLine, isPast && s.arcLinePast]} />
                  )}
                </View>
              );
            })}
          </View>
          <Text style={s.arcCurrent}>{ZONE_LABELS[currentZoneId]}</Text>
        </Pressable>

        {showAllZones && (
          <View style={s.allZones}>
            {ZONE_ORDER.map((zid) => {
              const z = zoneById[zid];
              if (!z) return null;
              const isCurrent = zid === currentZoneId;
              return (
                <View key={zid} style={[s.zoneListItem, isCurrent && s.zoneListItemCurrent]}>
                  <Text style={s.zoneListLabel}>{ZONE_LABELS[zid]}</Text>
                  <Text style={s.zoneListHeadline}>{z.headline}</Text>
                  <Text style={s.zoneListBody}>{z.body}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Goal thread */}
        {(profile?.goal || goalThread?.weeklyFocus || goalThread?.todayConnection) && (
          <View style={s.goalCard}>
            {profile?.goal && (
              <View style={s.goalLine}>
                <Text style={s.goalLineLabel}>Your goal</Text>
                <Text style={s.goalLineValue}>{truncateGoal(profile.goal)}</Text>
              </View>
            )}
            {goalThread?.weeklyFocus && (
              <View style={[s.goalLine, profile?.goal && s.goalLineDivider]}>
                <Text style={s.goalLineLabel}>This week's focus</Text>
                <Text style={s.goalLineValue}>{goalThread.weeklyFocus}</Text>
              </View>
            )}
            {goalThread?.todayConnection && (
              <View style={[s.goalLine, (profile?.goal || goalThread?.weeklyFocus) && s.goalLineDivider]}>
                <Text style={s.goalLineLabel}>Today's thread</Text>
                <Text style={s.goalLineValue}>{goalThread.todayConnection}</Text>
              </View>
            )}
          </View>
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
            <Text style={s.stressNotedText}>Noted. Tomorrow's plan accounts for this.</Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky stress button — sleek pill, centered, breathing dot */}
      {showStressBtn && (
        <View style={[s.stressBtnSticky, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <Pressable
            onPress={async () => {
              tapSelect();
              setShowStressRelief(true);
              setReliefLoading(true);
              setReliefText('');
              api.feedback({ type: 'stress_spike', dateISO: getLocalDateISO() }).catch(() => {});
              try {
                const r = await api.stressRelief();
                if (r?.text) setReliefText(r.text);
                else setReliefText(stressRelief || 'Inhale through your nose for 4. Hold 7. Exhale through your mouth for 8. Once is enough.');
              } catch {
                setReliefText(stressRelief || 'Inhale through your nose for 4. Hold 7. Exhale through your mouth for 8. Once is enough.');
              }
              setReliefLoading(false);
            }}
            style={({ pressed }) => [s.stressBtnInner, pressed && { transform: [{ scale: 0.97 }] }]}
          >
            <Animated.View style={[s.stressBtnDot, { opacity: stressDotOpacity }]} />
            <Text style={s.stressBtnText}>I'm stressed</Text>
          </Pressable>
        </View>
      )}

      {/* Stress relief modal — content fetched fresh per open */}
      <Modal
        visible={showStressRelief}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStressRelief(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowStressRelief(false)}>
          <Pressable style={s.modalContent} onPress={() => {}}>
            <Text style={s.modalLabel}>RIGHT NOW, DO THIS</Text>
            {reliefLoading ? (
              <View style={s.modalLoading}>
                <ActivityIndicator color={colors.gold} size="small" />
                <Text style={s.modalLoadingText}>Generating something for this moment…</Text>
              </View>
            ) : (
              <Text style={s.modalBody}>{reliefText}</Text>
            )}
            <Pressable
              style={({ pressed }) => [s.modalBtn, pressed && { opacity: 0.85 }, reliefLoading && { opacity: 0.5 }]}
              disabled={reliefLoading}
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 80 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBody: { color: colors.muted, marginBottom: 24, textAlign: 'center' },
  greeting: { fontSize: 26, fontWeight: '600', color: colors.text, marginBottom: 8, fontFamily: fonts.display },

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
  scoreChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    minWidth: 64,
  },
  scoreNum: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: colors.text,
    letterSpacing: 0.3,
    lineHeight: 28,
  },
  scoreLabel: {
    fontSize: 9,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  redoBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  redoIcon: { color: colors.muted, fontSize: 18, lineHeight: 22 },

  // Connect Apple Health banner
  healthBanner: {
    backgroundColor: 'rgba(196,168,108,0.08)',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  healthBannerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  healthBannerTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.text,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  healthBannerBody: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 16,
    letterSpacing: 0.1,
  },
  healthBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  healthBannerCta: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  healthBannerCtaText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  healthBannerSkip: {
    paddingVertical: 11,
    paddingHorizontal: 8,
  },
  healthBannerSkipText: {
    color: colors.muted,
    fontSize: 13,
  },

  // Zone hero
  zoneHero: {
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 22,
    paddingLeft: 26,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  zoneAccent: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 4,
    backgroundColor: colors.gold,
  },
  zoneTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  zoneLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 2,
  },
  nowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 5,
  },
  nowPillDot: {
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.bg,
  },
  nowPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.bg,
    letterSpacing: 1.4,
  },
  zoneHeadline: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.text,
    letterSpacing: 0.2,
    lineHeight: 28,
    marginBottom: 14,
  },
  zoneBody: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
    lineHeight: 24,
    letterSpacing: 0.1,
  },

  // Today's arc
  arcCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  arcHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  arcLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dim,
    letterSpacing: 1.6,
  },
  arcChevron: { color: colors.dim, fontSize: 12 },
  arcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  arcSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  arcDot: {
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.dim,
  },
  arcDotPast: {
    backgroundColor: colors.muted,
    borderColor: colors.muted,
  },
  arcDotCurrent: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  arcLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
    marginHorizontal: 2,
  },
  arcLinePast: { backgroundColor: colors.muted },
  arcCurrent: {
    fontFamily: fonts.displayItalic,
    fontSize: 13,
    color: colors.muted,
  },

  // All zones (expanded)
  allZones: { gap: 10, marginBottom: 16 },
  zoneListItem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
  },
  zoneListItemCurrent: {
    borderColor: colors.goldBorder,
    backgroundColor: 'rgba(196,168,108,0.06)',
  },
  zoneListLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  zoneListHeadline: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.text,
    marginBottom: 6,
    lineHeight: 22,
  },
  zoneListBody: {
    fontFamily: fonts.display,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
  },

  // Goal thread card
  goalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  goalLine: {
    paddingVertical: 12,
  },
  goalLineDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  goalLineLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  goalLineValue: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
    letterSpacing: 0.1,
  },

  // Evening reflection
  reflectionCard: {
    borderRadius: 14,
    padding: 18,
    marginTop: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  reflectionLabel: {
    fontSize: 10, fontWeight: '700', color: colors.gold,
    letterSpacing: 2, marginBottom: 8,
  },
  reflectionPrompt: {
    fontFamily: fonts.display,
    fontSize: 17, color: colors.text, lineHeight: 25, marginBottom: 16,
  },
  reflectionOptions: { flexDirection: 'row', gap: 8 },
  reflectionBtn: {
    flex: 1, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: 10, paddingVertical: 14, alignItems: 'center',
  },
  reflectionBtnText: { fontSize: 14, fontWeight: '500', color: colors.text },
  reflectionDoneCard: {
    paddingVertical: 16, marginTop: 8, alignItems: 'center',
  },
  reflectionDoneText: {
    fontFamily: fonts.displayItalic,
    fontSize: 14, color: colors.muted,
  },
  stressNotedCard: { paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  stressNotedText: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },

  // Sticky stress button — pill-shaped, centered, gold-soft fill, breathing dot
  stressBtnSticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stressBtnInner: {
    backgroundColor: 'rgba(196,168,108,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(196,168,108,0.42)',
    borderRadius: 30,
    paddingVertical: 13,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: colors.gold,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  stressBtnDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.gold,
  },
  stressBtnText: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.6,
  },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center', alignItems: 'center', padding: 28,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 18, padding: 26, width: '100%',
    borderWidth: 1, borderColor: colors.goldBorder,
  },
  modalLabel: {
    fontSize: 10, fontWeight: '700', color: colors.gold,
    letterSpacing: 2, marginBottom: 12,
  },
  modalBody: {
    fontFamily: fonts.display,
    fontSize: 17, color: colors.text, lineHeight: 26, marginBottom: 22,
  },
  modalLoading: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 14,
    marginBottom: 22,
  },
  modalLoadingText: {
    fontFamily: fonts.displayItalic,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  modalBtn: {
    backgroundColor: colors.gold,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  modalBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },

  // Empty state
  emptyCard: {
    marginTop: 32,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'flex-start',
  },
  emptyLabel: {
    fontSize: 10, fontWeight: '700', color: colors.gold,
    letterSpacing: 2, marginBottom: 14,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 26, color: colors.text, marginBottom: 12, letterSpacing: 0.2,
  },
  emptyBody: {
    fontFamily: fonts.display,
    fontSize: 15, color: colors.muted, lineHeight: 24, marginBottom: 22, letterSpacing: 0.1,
  },
  emptyCta: {
    alignSelf: 'stretch',
    backgroundColor: colors.gold,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12,
  },
  emptyCtaText: {
    color: colors.bg, fontSize: 15, fontWeight: '600', letterSpacing: 0.2,
  },
  emptyHint: {
    fontFamily: fonts.displayItalic,
    fontSize: 13, color: colors.dim, alignSelf: 'center',
  },

  // Shared
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: colors.bg, fontSize: 16, fontWeight: '600' },
});
