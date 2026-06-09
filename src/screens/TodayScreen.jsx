import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, AppState,
  Modal, ActivityIndicator, Share,
  Animated, LayoutAnimation, UIManager, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { useTheme, shadows } from '../theme';
import ShareCard from '../components/ShareCard';
import StreakShareCard, { milestoneTier } from '../components/StreakShareCard';
import GemUnlockModal from '../components/GemUnlockModal';
import IrisSignature from '../components/IrisSignature';
import DailyQuote from '../components/DailyQuote';
import CortisolFact from '../components/CortisolFact';
import RecommendationCard from '../components/RecommendationCard';
import SoundscapePlayer from '../components/SoundscapePlayer';
import StateRing from '../components/StateRing';
import GradientScreen from '../components/GradientScreen';
import FlameIcon from '../components/FlameIcon';
import { writeWidgetPayload } from '../widgetBridge';
import { startOrUpdateLiveActivity } from '../liveActivityBridge';
import { useAuthStore } from '../store/authStore';
import { tapLight, tapSelect, tapSuccess } from '../haptics';
import { maybePromptReview } from '../reviewPrompt';
import { getLocalDateISO, getYesterdayISO, getLogicalDateISO, isSleepWindow } from '../utils/localDate';
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
// Sleep window helper lives in utils/localDate so the same boundary
// (22:00-05:00 local) is enforced by the gate inside authStore.generatePlan
// AND the UI here. Don't duplicate the literal — single source of truth.

// Pulsing dot used for the "current zone" position on Today's Arc. A
// fixed-size gold core with an expanding ring around it — the ring loops
// scale + opacity so the dot reads as alive. The pulse animation is
// shared with the breathing dot on the stress button (passed in).
function ArcCurrentDot({ pulse }) {
  const ringStyle = {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#c4a86c',
    opacity: pulse.interpolate({ inputRange: [0.35, 1], outputRange: [0.45, 0] }),
    transform: [
      { scale: pulse.interpolate({ inputRange: [0.35, 1], outputRange: [1, 2.2] }) },
    ],
  };
  return (
    <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={ringStyle} />
      <View style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#c4a86c',
      }} />
    </View>
  );
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
  const { colors, fonts } = useTheme();
  const s = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  const insets = useSafeAreaInsets();
  const todayPlan = useAuthStore(s => s.todayPlan);
  const todayDate = useAuthStore(s => s.todayDate);
  const todayStress = useAuthStore(s => s.todayStress);
  const todayStressLabel = useAuthStore(s => s.todayStressLabel);
  const todaySleep = useAuthStore(s => s.todaySleep);
  const todayEnergy = useAuthStore(s => s.todayEnergy);
  const streak = useAuthStore(s => s.streak);
  const completed = useAuthStore(s => s.completed);
  const reflection = useAuthStore(s => s.reflection);
  const profile = useAuthStore(s => s.profile);
  const userName = useAuthStore(s => s.userName);
  const userId = useAuthStore(s => s.userId);
  const skippedDate = useAuthStore(s => s.skippedDate);
  const submitReflection = useAuthStore(s => s.submitReflection);
  const clearSkip = useAuthStore(s => s.clearSkip);
  const stressHistory = useAuthStore(s => s.stressHistory);
  const healthPermission = useAuthStore(s => s.healthPermission);
  const healthSnapshot = useAuthStore(s => s.healthSnapshot);
  const refreshHealthSnapshot = useAuthStore(s => s.refreshHealthSnapshot);
  const pendingGemUnlock = useAuthStore(s => s.pendingGemUnlock);
  const clearPendingGemUnlock = useAuthStore(s => s.clearPendingGemUnlock);

  const [currentZoneId, setCurrentZoneId] = useState(getCurrentZoneId());
  const [showStressRelief, setShowStressRelief] = useState(false);
  const [stressNoted, setStressNoted] = useState(false);
  const [showAllZones, setShowAllZones] = useState(false);
  const [zoneExpanded, setZoneExpanded] = useState(false);
  const [sharing, setSharing] = useState(null); // { type: 'zone'|'streak', payload }
  const [showScoreInfo, setShowScoreInfo] = useState(false);
  const [yesterdayReflection, setYesterdayReflection] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [shareVariant, setShareVariant] = useState('dark');
  const shareCardRef = useRef(null);
  const mountedRef = useRef(true);
  const stressNotedTimerRef = useRef(null);
  const reliefCallIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (stressNotedTimerRef.current) {
        clearTimeout(stressNotedTimerRef.current);
        stressNotedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('livenew:share_card_variant');
        if (v === 'cream' || v === 'dark') setShareVariant(v);
      } catch {}
    })();
  }, []);
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

  // Hydration + autoRoute gate. These USED to be two separate effects, which
  // raced: autoRoute would fire synchronously (reading the still-null Zustand
  // plan) and navigate away before the async AsyncStorage read could repopulate
  // the store. Result: users with a cached plan would get bounced back to
  // StressTap on every nav-to-Today/cold-boot. Now hydration finishes FIRST,
  // and autoRoute (below, gated on `hydrated`) only runs after we've actually
  // checked storage.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const check = async () => {
      const today = getLogicalDateISO();
      if (todayPlan && todayDate === today) {
        setHydrated(true);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem('livenew:plan');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.date === today && cached.contract) {
            useAuthStore.setState({
              todayPlan: cached.contract,
              todayDate: cached.date,
              todayStress: cached.stress,
              todayStressLabel: cached.stressLabel || null,
              todaySleep: cached.sleepQuality,
              todayEnergy: cached.energy,
              completed: cached.completed || {},
              reflection: cached.reflection || null,
            });
            setHydrated(true);
            return;
          }
        }
      } catch {}
      if (todayPlan && todayDate !== today) {
        useAuthStore.setState({
          todayPlan: null, todayDate: null, completed: {}, reflection: null,
        });
      }
      setHydrated(true);
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
  // Stress button is ALWAYS available — even with no plan loaded. The relief
  // is fresh AI per tap, falls back to a curated string if the API can't
  // reach. Don't gate the highest-value feature behind having a plan.
  const showStressBtn = true;

  // Score — derived from check-in + behavior + trend, AND HealthKit when available.
  const stressTrend = Array.isArray(stressHistory) ? stressHistory : [];
  const score = computeScore({
    stressLabel: todayStressLabel,
    sleepQuality: todaySleep,
    energy: todayEnergy,
    stressTrend,
    healthSnapshot,
  });

  // Plain-English breakdown of what's feeding the score, for the tap-to-explain modal.
  const scoreFactors = useMemo(() => {
    const out = [];
    const h = healthSnapshot;
    if (h?.sleepLastNightMinutes != null) {
      const hrs = Math.floor(h.sleepLastNightMinutes / 60);
      const mins = h.sleepLastNightMinutes % 60;
      out.push({ label: 'Sleep last night', value: `${hrs}h ${mins}m` });
    } else if (todaySleep) {
      out.push({ label: 'Sleep quality', value: todaySleep });
    }
    if (h?.hrvDeltaPct != null) {
      const sign = h.hrvDeltaPct >= 0 ? '+' : '';
      out.push({ label: 'HRV vs baseline', value: `${sign}${h.hrvDeltaPct}%` });
    }
    if (h?.rhrDelta != null) {
      const sign = h.rhrDelta >= 0 ? '+' : '';
      out.push({ label: 'Resting HR vs baseline', value: `${sign}${h.rhrDelta} bpm` });
    }
    if (todayStressLabel) {
      out.push({ label: 'Stress today', value: todayStressLabel });
    }
    if (todayEnergy && !h?.hrvDeltaPct) {
      out.push({ label: 'Energy', value: todayEnergy });
    }
    if (streak > 0) {
      out.push({ label: 'Streak', value: `${streak} day${streak === 1 ? '' : 's'}` });
    }
    return out;
  }, [healthSnapshot, todaySleep, todayStressLabel, todayEnergy, streak]);

  const scoreBandLabel = useMemo(() => {
    if (score >= 80) return "High — you're in a good zone.";
    if (score >= 60) return 'Mid-high — solid foundation, small wins available.';
    if (score >= 40) return "Mid — pay attention to what's pulling you down.";
    if (score >= 20) return 'Mid-low — be intentional today.';
    return 'Low — conserve. Tonight matters more than this morning.';
  }, [score]);
  const band = scoreBand(score);

  // Refresh the HealthKit snapshot whenever Today gains focus so the score
  // and any health-aware UI stays current. No-op when permission isn't granted.
  useFocusEffect(useCallback(() => {
    if (healthPermission === 'granted') {
      refreshHealthSnapshot().catch(() => {});
    }
  }, [healthPermission]));


  const { dayOfWeek, partOfDay } = getGreetingParts();

  // Auto-route on app open when there's no plan today. New flow:
  //   - First open of a fresh day → Overnight screen (morning ritual)
  //   - Already saw Overnight today → straight to StressTap (check-in)
  //   - User skipped today → don't route
  //   - Sleep window (22:00–05:00 local) → don't route; show calm sleep-mode
  //     empty state instead. Pushing a 1am user into a check-in for a plan
  //     that's already "ended" is the previous-build bug.
  // Only fires once per mount AND only after hydration confirms there's
  // genuinely no cached plan in storage. This kills the race where the
  // autoRoute saw a null Zustand plan before AsyncStorage finished loading.
  const autoRoutedRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (autoRoutedRef.current) return;
    if (todayPlan) return;
    const today = getLogicalDateISO();
    if (skippedDate === today) return;
    if (isSleepWindow()) return;
    autoRoutedRef.current = true;
    (async () => {
      let seen = null;
      try { seen = await AsyncStorage.getItem('livenew:seen_overnight_date'); } catch {}
      if (seen === today) {
        navigation.replace('StressTap');
      } else {
        navigation.replace('Overnight');
      }
    })();
  }, [hydrated, todayPlan, skippedDate, navigation]);

  // Read yesterday's reflection — drives the visible payoff callout that
  // shows the user Iris is actually using their evening reflection input.
  useEffect(() => {
    (async () => {
      try {
        const r = await AsyncStorage.getItem(`livenew:reflection:${getYesterdayISO()}`);
        if (r === 'better' || r === 'same' || r === 'harder') setYesterdayReflection(r);
        else setYesterdayReflection(null);
      } catch {}
    })();
  }, [todayPlan]);

  // First-plan welcome — one-time modal when the user lands on Today with
  // a plan loaded for the first time. Marks the arrival moment.
  //
  // The "seen" flag is keyed by userId so it survives logout (logout wipes
  // the legacy unscoped key, but not this per-account one). Without this, a
  // returning user re-saw the "it's your first time" welcome every sign-in.
  // We migrate the legacy unscoped flag → scoped on first read so existing
  // onboarded users don't get the modal one extra time.
  const welcomeKey = userId ? `livenew:seen_first_plan_welcome:${userId}` : 'livenew:seen_first_plan_welcome';
  useEffect(() => {
    if (!todayPlan) return;
    (async () => {
      try {
        let seen = await AsyncStorage.getItem(welcomeKey);
        if (!seen && userId) {
          const legacy = await AsyncStorage.getItem('livenew:seen_first_plan_welcome');
          if (legacy) {
            seen = legacy;
            try { await AsyncStorage.setItem(welcomeKey, '1'); } catch {}
          }
        }
        if (!seen) setShowWelcome(true);
      } catch {}
    })();
  }, [todayPlan, welcomeKey, userId]);

  const dismissWelcome = async () => {
    setShowWelcome(false);
    try { await AsyncStorage.setItem(welcomeKey, '1'); } catch {}
  };

  // Push the FULL day's plan into the App Group UserDefaults whenever a new
  // plan loads. The widget reads this once and self-rotates the displayed
  // zone by the system clock — no per-zone-tick re-writes needed. We also
  // start/update the Live Activity for the lockscreen + Dynamic Island. Both
  // helpers are iOS-only and silently no-op elsewhere.
  useEffect(() => {
    if (todayPlan?.zones?.length) {
      writeWidgetPayload({ zones: todayPlan.zones, score });
    }
    const z = zoneById[currentZoneId];
    if (z) startOrUpdateLiveActivity(z, score);
  }, [todayPlan, score, currentZoneId]);

  const handleReflection = (feeling) => {
    tapSuccess();
    submitReflection(feeling);
  };

  const shareAs = async (type, payload, message) => {
    tapSelect();
    setSharing({ type, payload });
    // Wait two frames for the hidden share card to paint before capturing.
    // Older devices need this extra time, otherwise capture fires on an
    // unpainted view and the share image is blank.
    await new Promise(r => setTimeout(r, 200));
    let captured = false;
    try {
      const uri = await captureRef(shareCardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      captured = true;
      await Share.share({ url: uri, message });
    } catch (err) {
      if (!captured) {
        Alert.alert("Couldn't create share image", "Try again in a moment.");
      }
      console.warn('[share]', err?.message);
    } finally {
      setSharing(null);
    }
  };

  const handleShare = (zone) => {
    if (!zone) return;
    shareAs('zone', zone, `${zone.pullQuote || zone.headline} — Iris @ LiveNew`);
  };

  const handleShareStreak = () => {
    if (!streak || streak < 1) return;
    const tier = milestoneTier(streak);
    shareAs('streak', { days: streak }, `${streak} day${streak === 1 ? '' : 's'} on LiveNew — ${tier.subtitle}`);
  };

  // Stress button + modal — reused across the with-plan and empty-state
  // renders so it's available from the very first app open.
  const stressBtnAndModal = (
    <>
      <View style={[s.stressBtnSticky, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <Pressable
          onPress={async () => {
            tapSelect();
            const callId = ++reliefCallIdRef.current;
            setShowStressRelief(true);
            setReliefLoading(true);
            setReliefText('');
            api.feedback({ type: 'stress_spike', dateISO: getLocalDateISO() }).catch(() => {});
            try {
              const r = await api.stressRelief();
              if (!mountedRef.current || callId !== reliefCallIdRef.current) return;
              if (r?.text) setReliefText(r.text);
              else setReliefText(stressRelief || 'Inhale through your nose for 4. Hold 7. Exhale through your mouth for 8. Once is enough.');
            } catch {
              if (!mountedRef.current || callId !== reliefCallIdRef.current) return;
              setReliefText(stressRelief || 'Inhale through your nose for 4. Hold 7. Exhale through your mouth for 8. Once is enough.');
            }
            if (mountedRef.current && callId === reliefCallIdRef.current) {
              setReliefLoading(false);
            }
          }}
          style={({ pressed }) => [s.stressBtnInner, pressed && { transform: [{ scale: 0.97 }] }]}
        >
          <Animated.View style={[s.stressBtnDot, { opacity: stressDotOpacity }]} />
          <Text style={s.stressBtnText}>I'm stressed</Text>
        </Pressable>
      </View>
      <Modal
        visible={showStressRelief}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStressRelief(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowStressRelief(false)}>
          <Pressable style={s.modalContent} onPress={() => {}}>
            <View style={s.modalSignatureRow}>
              <IrisSignature />
              <Text style={s.modalLabelSoft}>for this moment</Text>
            </View>
            {reliefLoading ? (
              <View style={s.modalLoading}>
                <ActivityIndicator color={colors.gold} size="small" />
                <Text style={s.modalLoadingText}>Iris is finding something for this moment…</Text>
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
                if (stressNotedTimerRef.current) clearTimeout(stressNotedTimerRef.current);
                stressNotedTimerRef.current = setTimeout(() => {
                  if (mountedRef.current) setStressNoted(false);
                  stressNotedTimerRef.current = null;
                }, 4000);
              }}
            >
              <Text style={s.modalBtnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );

  // Empty / loading / skipped states
  const today = getLogicalDateISO();
  if (!todayPlan) {
    // No plan loaded — show the "Start today" empty card. There's no
    // auto-generation; the user has to tap Start to begin a check-in.
    // (Earlier `if (skippedDate === today || true)` was load-bearing despite
    // looking like a bug; removing it stranded users on a forever-spinner.)
    const morning = new Date().getHours() < 12;
    const sleepMode = isSleepWindow();
    return (
      <GradientScreen edges={['top']}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.greetingDay}>{userName ? `Hi, ${userName}.` : dayOfWeek.toLowerCase()}</Text>
              <Text style={s.greetingPart}>{userName ? `${dayOfWeek.toLowerCase()} ${partOfDay}` : partOfDay}</Text>
            </View>
          </View>

          {/* Streak-at-risk nudge — after 7pm with no plan today and a
              streak worth saving. Quiet, not nagging. Suppressed inside the
              sleep window — pushing a streak-save at 2am defeats the point. */}
          {!sleepMode && streak >= 1 && new Date().getHours() >= 19 ? (
            <View style={s.streakRiskCard}>
              <View style={s.streakRiskHeader}>
                <View style={s.streakRiskFire}><FlameIcon size={17} color={colors.gold} /></View>
                <Text style={s.streakRiskNum}>{streak}</Text>
                <Text style={s.streakRiskLabel}>day{streak === 1 ? '' : 's'} at risk</Text>
              </View>
              <Text style={s.streakRiskBody}>
                Three taps keep it alive. Past midnight, the streak resets.
              </Text>
            </View>
          ) : null}

          {sleepMode ? (
            // Sleep-window empty state. Hard block — NO escape hatch to plan
            // generation. A plan generated at 2am is for a day that's mostly
            // already over; it reads as broken. The stress button below is
            // the only late-night interaction we offer: anxiety doesn't sleep
            // and Iris should be there for it, but the daily plan can wait.
            <View style={s.sleepCard}>
              <Text style={s.sleepLabel}>SLEEP WINDOW</Text>
              <Text style={s.sleepTitle}>It's late.</Text>
              <Text style={s.sleepBody}>
                Iris is offline until morning. The plan she'll build for you at sunrise will be sharper than anything she can put together right now — your overnight sleep and HRV shape every zone.
              </Text>
              <Text style={s.sleepBody}>
                Try to rest. We'll meet in the morning.
              </Text>
              <Text style={s.sleepFootnote}>
                Still stressed? Tap "I'm stressed" below. That part of Iris never sleeps.
              </Text>
            </View>
          ) : (
            <View style={s.emptyCard}>
              <Text style={s.emptyLabel}>NO PLAN YET</Text>
              <Text style={s.emptyTitle}>{morning ? 'A new day.' : 'Ready when you are.'}</Text>
              <Text style={s.emptyBody}>
                Three taps. I'll tune today around your sleep, your stress, and your energy.
              </Text>
              <Pressable
                style={({ pressed }) => [s.emptyCta, pressed && { opacity: 0.85 }]}
                onPress={async () => {
                  tapSelect();
                  try { await clearSkip(); } catch (err) { console.warn('[today] clearSkip failed', err?.message); }
                  navigation.replace('StressTap');
                }}
              >
                <Text style={s.emptyCtaText}>Start today</Text>
              </Pressable>
              <Text style={s.emptyHint}>Or tap "I'm stressed" if you just need a moment.</Text>
              <CortisolFact style={s.emptyFactCard} />
            </View>
          )}
        </ScrollView>
        {stressBtnAndModal}
      </GradientScreen>
    );
  }

  if (zones.length === 0) {
    return (
      <GradientScreen edges={['top']}>
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
      </GradientScreen>
    );
  }

  const currentZoneIndex = ZONE_ORDER.indexOf(currentZoneId);

  return (
    <GradientScreen edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: showStressBtn ? 140 : 80 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Header — greeting + streak/score + redo. The Iris signature mark
            was removed here; the "Ask Iris anything →" gold link below
            already carries the brand and is interactive. */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.greetingDay}>{userName ? `Hi, ${userName}.` : dayOfWeek.toLowerCase()}</Text>
            <Text style={s.greetingPart}>{userName ? `${dayOfWeek.toLowerCase()} ${partOfDay}` : partOfDay}</Text>
            <Pressable
              onPress={() => { tapLight(); navigation.navigate('Chat'); }}
              hitSlop={6}
              style={s.askIris}
            >
              <Text style={s.askIrisText}>Ask Iris anything →</Text>
            </Pressable>
          </View>
          {/* Streak chip — only when the number is meaningful. Showing
              "1 DAY" on day one reads as filler, not pride. From day 2 the
              streak becomes the social-shareable hook. */}
          {streak >= 2 ? (
            <Pressable onPress={handleShareStreak} hitSlop={6} style={s.streakChip}>
              <Text style={s.streakNum}>{streak}</Text>
              <Text style={s.streakLabel}>days</Text>
            </Pressable>
          ) : null}
          {/* Hide the "redo plan" button during sleep window — regenerating
              a plan at 10pm makes no sense, the day is done. */}
          {currentZoneId !== 'sleep' ? (
            <Pressable
              onPress={() => { tapSelect(); navigation.replace('StressTap'); }}
              hitSlop={10}
              style={s.redoBtn}
            >
              <Text style={s.redoIcon}>↻</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Hero state ring — today's regulation read, promoted from a buried
            chip to the centerpiece of Today (the Opal "Focus Score" move).
            Tapping it opens the same plain-English breakdown the chip did. */}
        <View style={s.heroRing}>
          <StateRing
            score={score}
            onPress={() => { tapLight(); setShowScoreInfo(true); }}
          />
          <Text style={s.heroBand}>{scoreBandLabel}</Text>
        </View>

        {/* Daily first read — single Iris-voiced sentence anchored in
            today's actual data. Earns the open. Shown above everything else. */}
        {todayPlan?.firstRead ? (
          <View style={s.firstRead}>
            <View style={s.firstReadMarkRow}>
              <View style={s.firstReadMark} />
              <IrisSignature />
            </View>
            <Text style={s.firstReadText}>{todayPlan.firstRead}</Text>
          </View>
        ) : null}

        {/* Daily quote — a calming anchor. Rotates each calendar day. */}
        <DailyQuote style={s.dailyQuoteCard} />

        {/* Yesterday's reflection payoff — show that Iris listened. */}
        {yesterdayReflection ? (
          <View style={s.reflectionPayoff}>
            <View style={s.reflectionPayoffHeader}>
              <IrisSignature />
              <Text style={s.reflectionPayoffSuffix}>
                {yesterdayReflection === 'better' ? 'kept what worked' :
                 yesterdayReflection === 'harder' ? 'eased off' : 'kept things steady'}
              </Text>
            </View>
            <Text style={s.reflectionPayoffBody}>
              {yesterdayReflection === 'better' && "Yesterday felt better. Today builds on what worked."}
              {yesterdayReflection === 'same' && "Yesterday felt steady. Today holds the line."}
              {yesterdayReflection === 'harder' && "Yesterday felt harder. Today eases the load."}
            </Text>
          </View>
        ) : null}

        {/* Wind-down banner — appears only while the sleep zone is current
            (after 9:30pm). The day's protocols are done, this is the close.
            Iris voice signals it explicitly so the user knows the rhythm. */}
        {currentZoneId === 'sleep' ? (
          <View style={s.windDownCard}>
            <Text style={s.windDownLabel}>WIND-DOWN</Text>
            <Text style={s.windDownLine}>
              That's today. I'm offline until morning.
            </Text>
            <Text style={s.windDownSub}>
              Reflect below if you haven't yet — it shapes tomorrow.
            </Text>
          </View>
        ) : null}

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

            {currentZone.pullQuote ? (
              <View style={s.pullQuoteWrap}>
                <Text style={s.pullQuoteText}>{currentZone.pullQuote}</Text>
                <View style={s.pullQuoteAttribution}>
                  <Text style={s.pullQuoteDash}>—</Text>
                  <IrisSignature />
                </View>
              </View>
            ) : null}

            {zoneExpanded ? (
              <Text style={s.zoneBody}>{currentZone.body}</Text>
            ) : null}

            {/* Single elegant Show more / Show less link — centered, gold
                italic. Replaces the previous cluttered Listen + Share +
                Read more button row. The hairline divider above gives it
                weight without competing visually with the headline. */}
            <View style={s.zoneFooterDivider} />
            <Pressable
              onPress={() => {
                tapLight();
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setZoneExpanded(v => !v);
              }}
              hitSlop={12}
              style={s.zoneShowMore}
            >
              <Text style={s.zoneShowMoreText}>
                {zoneExpanded ? 'Show less' : 'Show more'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Today's arc — animated timeline. Current dot pulses with a gold
            glow ring; past dots are solid gold; future dots are outlined.
            Line between dots is gold up to the current segment, muted
            after. The whole card taps to expand all zones below. */}
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
                  {isCurrent ? (
                    <ArcCurrentDot pulse={stressDotOpacity} />
                  ) : (
                    <View style={[s.arcDot, isPast && s.arcDotPast]} />
                  )}
                  {i < ZONE_ORDER.length - 1 && (
                    <View style={[
                      s.arcLine,
                      (isPast || isCurrent) && s.arcLinePast,
                    ]} />
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

        {/* Iris's week + day thread — what she's narratively working toward */}
        {(goalThread?.weeklyFocus || goalThread?.todayConnection) && (
          <View style={s.goalCard}>
            {goalThread?.weeklyFocus && (
              <View style={s.goalLine}>
                <Text style={s.goalLineLabel}>This week's focus</Text>
                <Text style={s.goalLineValue}>{goalThread.weeklyFocus}</Text>
              </View>
            )}
            {goalThread?.todayConnection && (
              <View style={[s.goalLine, goalThread?.weeklyFocus && s.goalLineDivider]}>
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
              {reflection === 'better' ? 'Glad today was better.' : reflection === 'harder' ? 'Tomorrow I adjust.' : 'Noted. Consistency compounds.'}
            </Text>
          </View>
        )}
        {stressNoted && (
          <View style={s.stressNotedCard}>
            <Text style={s.stressNotedText}>Noted. Tomorrow's plan accounts for this.</Text>
          </View>
        )}

        {/* One more thing for today — a time-of-day-aware action Iris surfaces
            beyond the plan. Day-stable; changes once per calendar day. */}
        <RecommendationCard style={s.recCard} />

        {/* Soundscape player — ambient audio to settle the nervous system.
            Sits at the bottom of the populated plan as a "settle the system"
            moment; looping brown noise, rain, pink noise, or stillness. */}
        <SoundscapePlayer style={s.soundscapeCard} onUpgrade={() => navigation.navigate('Paywall')} />
      </ScrollView>

      {/* Sticky stress button + relief modal — defined once above, reused
          here AND on the empty-state branch so the most valuable feature is
          always one tap away. */}
      {stressBtnAndModal}

      {/* Hidden share card — positioned off-screen, captured by view-shot when sharing */}
      {sharing ? (
        <View style={s.shareCardHidden} pointerEvents="none">
          {sharing.type === 'zone' ? (
            <ShareCard
              innerRef={shareCardRef}
              headline={sharing.payload.headline}
              pullQuote={sharing.payload.pullQuote}
              zoneLabel={ZONE_LABELS[sharing.payload.id] || ''}
              score={score}
              variant={shareVariant}
            />
          ) : null}
          {sharing.type === 'streak' ? (
            <StreakShareCard innerRef={shareCardRef} days={sharing.payload.days} variant={shareVariant} />
          ) : null}
        </View>
      ) : null}

      {/* First-plan welcome — one-time arrival moment */}
      <Modal
        visible={showWelcome}
        transparent
        animationType="fade"
        onRequestClose={dismissWelcome}
      >
        <Pressable style={s.modalOverlay} onPress={dismissWelcome}>
          <Pressable style={s.welcomeContent} onPress={() => {}}>
            <View style={s.modalSignatureRow}>
              <IrisSignature size="header" />
            </View>
            <Text style={s.welcomeTitle}>
              {userName ? `Hi, ${userName}.` : 'Hi.'}
            </Text>
            <Text style={s.welcomeBody}>
              This is your first day with me. I'll meet you at the eight inflection points of your cortisol curve — real protocols, specific doses, no fluff.
            </Text>
            <Text style={s.welcomeBody}>
              Tap "Show more" on any zone for the full protocol. Tap "I'm stressed" any time for an on-demand action. Tap "Ask Iris anything" to chat directly.
            </Text>
            <Text style={s.welcomeBody}>
              The longer you show up, the sharper I get. Tonight's evening reflection is three taps — and shapes tomorrow.
            </Text>
            <Pressable
              style={({ pressed }) => [s.modalBtn, pressed && { opacity: 0.85 }]}
              onPress={dismissWelcome}
            >
              <Text style={s.modalBtnText}>Let's go</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Score breakdown modal — what's contributing to today's number */}
      <Modal
        visible={showScoreInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowScoreInfo(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowScoreInfo(false)}>
          <Pressable style={s.scoreInfoContent} onPress={() => {}}>
            <View style={s.modalSignatureRow}>
              <IrisSignature />
              <Text style={s.modalLabelSoft}>what this score means</Text>
            </View>
            <Text style={s.scoreInfoNum}>{score}</Text>
            <Text style={s.scoreInfoBand}>{scoreBandLabel}</Text>
            <View style={s.scoreFactorList}>
              {scoreFactors.map((f, i) => (
                <View key={i} style={[s.scoreFactorRow, i > 0 && s.scoreFactorDivider]}>
                  <Text style={s.scoreFactorLabel}>{f.label}</Text>
                  <Text style={s.scoreFactorValue}>{f.value}</Text>
                </View>
              ))}
              {scoreFactors.length === 0 ? (
                <Text style={s.scoreFactorEmpty}>
                  Defaults until you check in or connect Apple Health.
                </Text>
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [s.modalBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setShowScoreInfo(false)}
            >
              <Text style={s.modalBtnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Gem-unlock celebration — driven by pendingGemUnlock from the store */}
      <GemUnlockModal gemId={pendingGemUnlock} onClose={clearPendingGemUnlock} />
    </GradientScreen>
  );
}

function makeStyles(colors, fonts) {
  const elev = shadows[colors.scheme === 'light' ? 'light' : 'dark'];
  return StyleSheet.create({
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
  // Hero state ring — centered centerpiece below the header.
  heroRing: {
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 22,
  },
  heroBand: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.2,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  askIris: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  askIrisText: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.gold,
    letterSpacing: 0.3,
  },
  streakChip: {
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    minWidth: 60,
  },
  streakNum: {
    fontFamily: fonts.accentBold,
    fontSize: 22,
    color: colors.gold,
    lineHeight: 26,
    letterSpacing: 0.3,
  },
  streakLabel: {
    fontFamily: fonts.displaySemibold,
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: -2,
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

  // Daily quote — calm anchor placed just under the first-read block.
  dailyQuoteCard: {
    marginBottom: 8,
  },

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
    color: '#1a1612',
    fontFamily: fonts.displayBold,
    fontSize: 14,
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

  // Wind-down banner — shown during the sleep zone (after 9:30pm).
  // Calmer styling than the zone hero: muted surface, no gold accent bar.
  // Signals "the day is closing" without competing visually with the
  // zone card or the reflection prompt below.
  windDownCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  windDownLabel: {
    fontFamily: fonts.displaySemibold,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  windDownLine: {
    fontFamily: fonts.italic,
    fontSize: 17,
    color: colors.text,
    lineHeight: 24,
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  windDownSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },

  // Zone hero
  zoneHero: {
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    paddingLeft: 24,
    marginBottom: 18,
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
    marginBottom: 10,
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
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#1a1612',
  },
  nowPillText: {
    fontFamily: fonts.displayBold,
    fontSize: 9,
    color: '#1a1612',
    letterSpacing: 1.4,
  },
  zoneHeadline: {
    fontFamily: fonts.displayBold,
    fontSize: 23,
    color: colors.text,
    letterSpacing: -0.2,
    lineHeight: 30,
    marginBottom: 12,
  },
  pullQuoteWrap: {
    paddingVertical: 2,
    marginBottom: 12,
  },
  pullQuoteText: {
    fontFamily: fonts.italic,
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    letterSpacing: 0.1,
  },
  pullQuoteAttribution: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 4,
  },
  pullQuoteDash: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.gold,
  },
  zoneBody: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
    lineHeight: 24,
    letterSpacing: 0.1,
    marginBottom: 16,
  },
  // Hairline divider above the Show more / Show less link. Subtle weight
  // separation between the content and the toggle without a heavy bar.
  zoneFooterDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginTop: 12,
    marginHorizontal: -4,
  },
  zoneShowMore: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  zoneShowMoreText: {
    fontFamily: fonts.italic,
    fontSize: 14,
    color: colors.gold,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  shareCardHidden: {
    position: 'absolute',
    top: -10000,
    left: 0,
    opacity: 1,
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
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  arcLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: colors.line,
    marginHorizontal: 3,
    borderRadius: 1,
  },
  arcLinePast: { backgroundColor: colors.gold },
  arcCurrent: {
    fontFamily: fonts.italic,
    fontSize: 14,
    color: colors.gold,
    letterSpacing: 0.4,
    marginTop: 4,
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

  // Recommendation card — "one more thing for today", after plan content
  recCard: {
    marginTop: 20,
  },

  // Soundscape player — ambient audio card below the recommendation card.
  soundscapeCard: {
    marginTop: 16,
  },

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
    flex: 1, backgroundColor: colors.modalOverlay,
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
  modalSignatureRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 14,
  },
  modalLabelSoft: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.2,
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
  modalBtnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 16, letterSpacing: 0.2 },

  milestoneContent: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 32,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    alignItems: 'center',
  },
  // Daily first read — the magnetic single-sentence opener Iris writes per day
  firstRead: {
    marginBottom: 18,
    paddingLeft: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  firstReadMarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  firstReadMark: {
    width: 16,
    height: 1,
    backgroundColor: colors.gold,
  },
  firstReadText: {
    fontFamily: fonts.italic,
    fontSize: 19,
    color: colors.text,
    lineHeight: 28,
    letterSpacing: -0.1,
  },
  reflectionPayoff: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  reflectionPayoffHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 6,
  },
  reflectionPayoffSuffix: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
  },
  reflectionPayoffBody: {
    fontFamily: fonts.italic,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  streakRiskCard: {
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    ...elev,
  },
  streakRiskHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 6,
  },
  streakRiskFire: { marginRight: 6 },
  streakRiskNum: {
    fontFamily: fonts.accentBold,
    fontSize: 22,
    color: colors.error,
    letterSpacing: 0.2,
  },
  streakRiskLabel: {
    fontFamily: fonts.displaySemibold,
    fontSize: 12,
    color: colors.error,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  streakRiskBody: {
    fontFamily: fonts.italic,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  welcomeContent: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 28,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  welcomeTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.2,
    marginTop: 12,
    marginBottom: 16,
  },
  welcomeBody: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
    marginBottom: 14,
    letterSpacing: 0.1,
  },
  scoreInfoContent: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 28,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  scoreInfoNum: {
    fontFamily: fonts.accentBold,
    fontSize: 72,
    color: colors.gold,
    letterSpacing: -2,
    lineHeight: 76,
    textAlign: 'center',
    marginTop: 4,
  },
  scoreInfoBand: {
    fontFamily: fonts.italic,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  scoreFactorList: {
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  scoreFactorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  scoreFactorDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  scoreFactorLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.1,
  },
  scoreFactorValue: {
    fontFamily: fonts.displaySemibold,
    fontSize: 14,
    color: colors.text,
    letterSpacing: 0.1,
  },
  scoreFactorEmpty: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 14,
    textAlign: 'center',
  },
  milestoneSignatureRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 14,
  },
  milestoneSignatureSuffix: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
  },
  milestoneTier: {
    fontFamily: fonts.displayBold,
    fontSize: 12,
    color: colors.gold,
    letterSpacing: 3,
    marginBottom: 16,
  },
  milestoneNum: {
    fontFamily: fonts.accentBold,
    fontSize: 96,
    color: colors.gold,
    letterSpacing: -2,
    lineHeight: 100,
  },
  milestoneSub: {
    fontFamily: fonts.italic,
    fontSize: 18,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  milestoneSecondary: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  milestoneSecondaryText: {
    fontFamily: fonts.displaySemibold,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  // Sleep-window empty state — calmer than the daytime variant. No primary
  // CTA, muted text, gold-soft frame. Signals "the day is closed" without
  // making the user feel like they hit a dead end.
  sleepCard: {
    marginTop: 32,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
    alignItems: 'flex-start',
    ...elev,
  },
  sleepLabel: {
    fontFamily: fonts.displaySemibold,
    fontSize: 10,
    color: colors.gold,
    letterSpacing: 1.8,
    marginBottom: 14,
  },
  sleepTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.text,
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  sleepBody: {
    fontFamily: fonts.italic,
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
    marginBottom: 14,
    letterSpacing: 0.1,
  },
  // Quiet footnote on the sleep card pointing users to the stress button.
  // Italic, muted — informational, not a CTA. Lives directly under the
  // sleep body copy so it reads as part of Iris's voice.
  sleepFootnote: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 8,
    letterSpacing: 0.1,
  },

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
    ...elev,
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
    color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 15, letterSpacing: 0.2,
  },
  emptyHint: {
    fontFamily: fonts.displayItalic,
    fontSize: 13, color: colors.dim, alignSelf: 'center',
  },
  // Cortisol fact card in the empty/no-plan state — sits below the hint,
  // gives the user a reason to come back and start today.
  emptyFactCard: {
    marginTop: 20,
    alignSelf: 'stretch',
  },

  // Shared
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 16 },
  });
}
