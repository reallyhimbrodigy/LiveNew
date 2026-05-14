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
import { useTheme } from '../theme';
import ShareCard from '../components/ShareCard';
import StreakShareCard, { milestoneTier } from '../components/StreakShareCard';
import IrisSignature from '../components/IrisSignature';
import { speakAsIris, stopSpeaking } from '../utils/irisVoice';
import { writeWidgetPayload } from '../widgetBridge';
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

// Small SVG-free speaker icon drawn with View primitives. A trapezoid body
// and two sound-wave arcs (approximated with thin bordered circles). Looks
// clean at the 28x28 size we use for the Listen button.
function SpeakerGlyph({ color = '#c4a86c', size = 14 }) {
  const body = {
    width: size * 0.5,
    height: size * 0.7,
    backgroundColor: color,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  };
  const wave = {
    position: 'absolute',
    right: -4,
    width: size * 0.45,
    height: size * 0.45,
    borderRadius: size * 0.225,
    borderWidth: 1.6,
    borderColor: color,
    borderLeftColor: 'transparent',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  };
  return (
    <View style={{ width: size + 4, height: size + 2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={body} />
      <View style={wave} />
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
  const [zoneExpanded, setZoneExpanded] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sharing, setSharing] = useState(null); // { type: 'zone'|'streak', payload }
  const [showMilestone, setShowMilestone] = useState(null); // milestone days int
  const [showGoalNudge, setShowGoalNudge] = useState(false);
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
    stressLabel: todayStressLabel,
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

  // Goal nudge: show ONLY when goal is the onboarding default placeholder
  // ("I just want to feel better overall") OR empty. If the user explicitly
  // picked a goal (even one of the presets), they've engaged — don't nag.
  // Suppressed for 3 days after dismissal.
  useEffect(() => {
    (async () => {
      const goal = (profile?.goal || '').trim();
      const isPlaceholder = !goal || /^I just want to feel better overall$/i.test(goal);
      if (!isPlaceholder) { setShowGoalNudge(false); return; }
      try {
        const dismissedAt = await AsyncStorage.getItem('livenew:goal_nudge_dismissed');
        const ts = dismissedAt ? parseInt(dismissedAt, 10) : 0;
        const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
        setShowGoalNudge(!ts || days > 3);
      } catch {
        setShowGoalNudge(true);
      }
    })();
  }, [profile?.goal]);

  // Push the current zone payload into the App Group UserDefaults so the iOS
  // home-screen widget can read it. Fires whenever the current zone or score
  // changes — runs only on iOS, silently no-ops elsewhere.
  useEffect(() => {
    const z = zoneById[currentZoneId];
    if (!z) return;
    writeWidgetPayload({
      headline: z.headline,
      pullQuote: z.pullQuote,
      zoneLabel: ZONE_LABELS[currentZoneId] || '',
      score,
    });
  }, [currentZoneId, score, todayPlan]);

  const handleReflection = (feeling) => {
    tapSuccess();
    submitReflection(feeling);
  };

  const handleListen = async (zone) => {
    if (!zone) return;
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    tapLight();
    setIsSpeaking(true);
    // Include the pull-quote in what Iris reads — it's the most quotable line.
    const text = [zone.headline, zone.pullQuote, zone.body].filter(Boolean).join('. ');
    await speakAsIris(text, {
      onDone: () => { if (mountedRef.current) setIsSpeaking(false); },
      onStopped: () => { if (mountedRef.current) setIsSpeaking(false); },
      onError: () => { if (mountedRef.current) setIsSpeaking(false); },
    });
  };

  useEffect(() => () => { stopSpeaking(); }, []);

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

  // Milestone celebration — fire once per milestone crossed.
  useEffect(() => {
    if (!streak) return;
    const milestones = [3, 7, 14, 30, 100];
    if (!milestones.includes(streak)) return;
    (async () => {
      const key = 'livenew:lastCelebratedStreak';
      try {
        const lastRaw = await AsyncStorage.getItem(key);
        const last = lastRaw ? parseInt(lastRaw, 10) : 0;
        if (streak <= last) return;
        await AsyncStorage.setItem(key, String(streak));
        setShowMilestone(streak);
      } catch {}
    })();
  }, [streak]);

  // Empty / loading / skipped states
  const today = getLocalDateISO();
  if (!todayPlan) {
    // No plan loaded — show the "Start today" empty card. There's no
    // auto-generation; the user has to tap Start to begin a check-in.
    // (Earlier `if (skippedDate === today || true)` was load-bearing despite
    // looking like a bug; removing it stranded users on a forever-spinner.)
    const morning = new Date().getHours() < 12;
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <IrisSignature size="header" style={{ marginBottom: 4 }} />
              <Text style={s.greetingDay}>{dayOfWeek.toLowerCase()}</Text>
              <Text style={s.greetingPart}>{partOfDay}</Text>
            </View>
          </View>

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

        {/* Header — Iris signature + greeting + streak/score + redo */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <IrisSignature size="header" style={{ marginBottom: 4 }} />
            <Text style={s.greetingDay}>{dayOfWeek.toLowerCase()}</Text>
            <Text style={s.greetingPart}>{partOfDay}</Text>
          </View>
          {streak > 0 ? (
            <Pressable onPress={handleShareStreak} hitSlop={6} style={s.streakChip}>
              <Text style={s.streakNum}>{streak}</Text>
              <Text style={s.streakLabel}>day{streak === 1 ? '' : 's'}</Text>
            </Pressable>
          ) : null}
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

            {currentZone.pullQuote ? (
              <View style={s.pullQuoteWrap}>
                <Text style={s.pullQuoteMark}>"</Text>
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

            <View style={s.zoneActions}>
              <Pressable
                onPress={() => handleListen(currentZone)}
                hitSlop={10}
                style={[s.listenBtn, isSpeaking && s.listenBtnActive]}
                accessibilityLabel={isSpeaking ? 'Stop Iris' : 'Hear from Iris'}
              >
                {isSpeaking ? (
                  <View style={s.stopGlyph} />
                ) : (
                  <SpeakerGlyph color={colors.gold} />
                )}
              </Pressable>
              <View style={s.zoneActionsRight}>
                <Pressable style={s.zoneAction} onPress={() => handleShare(currentZone)} hitSlop={6}>
                  <Text style={s.zoneActionIcon}>↗</Text>
                  <Text style={s.zoneActionText}>Share</Text>
                </Pressable>
                <Pressable
                  style={s.zoneAction}
                  onPress={() => {
                    tapLight();
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setZoneExpanded(v => !v);
                  }}
                  hitSlop={6}
                >
                  <Text style={s.zoneActionText}>{zoneExpanded ? 'Less' : 'Read more'}</Text>
                </Pressable>
              </View>
            </View>
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

        {/* Goal nudge — shown when the user hasn't set a goal yet (default
            placeholder "feel better generally" set during onboarding shrink). */}
        {showGoalNudge && (
          <Pressable
            style={s.goalNudge}
            onPress={() => { tapLight(); navigation.navigate('GoalPicker'); }}
          >
            <View style={s.goalNudgeHeader}>
              <IrisSignature />
              <Text style={s.goalNudgeHeaderSuffix}>wants to dial this in</Text>
            </View>
            <Text style={s.goalNudgeBody}>
              I can sharpen this if you tell me what actually matters. Pick one →
            </Text>
            <Pressable
              style={s.goalNudgeDismiss}
              onPress={async () => {
                tapLight();
                try { await AsyncStorage.setItem('livenew:goal_nudge_dismissed', String(Date.now())); } catch {}
                setShowGoalNudge(false);
              }}
              hitSlop={8}
            >
              <Text style={s.goalNudgeDismissText}>×</Text>
            </Pressable>
          </Pressable>
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
              {reflection === 'better' ? 'Glad today was better.' : reflection === 'harder' ? 'Tomorrow I adjust.' : 'Noted. Consistency compounds.'}
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
              const callId = ++reliefCallIdRef.current;
              setShowStressRelief(true);
              setReliefLoading(true);
              setReliefText('');
              api.feedback({ type: 'stress_spike', dateISO: getLocalDateISO() }).catch(() => {});
              try {
                const r = await api.stressRelief();
                // Stale response guard: if the user closed the modal and
                // reopened (or unmounted) before this finished, ignore.
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
              <Text style={s.modalBtnText}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Milestone celebration modal */}
      <Modal
        visible={showMilestone != null}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMilestone(null)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowMilestone(null)}>
          <Pressable style={s.milestoneContent} onPress={() => {}}>
            <View style={s.milestoneSignatureRow}>
              <IrisSignature />
              <Text style={s.milestoneSignatureSuffix}>noticed this</Text>
            </View>
            <Text style={s.milestoneTier}>
              {showMilestone != null ? milestoneTier(showMilestone).label : ''}
            </Text>
            <Text style={s.milestoneNum}>{showMilestone}</Text>
            <Text style={s.milestoneSub}>
              {showMilestone != null ? milestoneTier(showMilestone).subtitle : ''}
            </Text>
            <View style={{ height: 8 }} />
            <Pressable
              style={({ pressed }) => [s.modalBtn, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setShowMilestone(null);
                handleShareStreak();
              }}
            >
              <Text style={s.modalBtnText}>Share this</Text>
            </Pressable>
            <Pressable
              style={s.milestoneSecondary}
              onPress={() => setShowMilestone(null)}
            >
              <Text style={s.milestoneSecondaryText}>Keep going</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors, fonts) {
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
    fontSize: 24,
    color: colors.text,
    letterSpacing: -0.2,
    lineHeight: 31,
    marginBottom: 16,
  },
  pullQuoteWrap: {
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    marginBottom: 18,
    position: 'relative',
  },
  pullQuoteMark: {
    position: 'absolute',
    left: -6,
    top: -10,
    fontFamily: fonts.accentBold,
    fontSize: 48,
    color: colors.gold,
    opacity: 0.5,
    lineHeight: 48,
  },
  pullQuoteText: {
    fontFamily: fonts.italic,
    fontSize: 17,
    color: colors.text,
    lineHeight: 26,
    letterSpacing: 0.1,
    paddingLeft: 22,
  },
  pullQuoteAttribution: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingLeft: 22,
    marginTop: 6,
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
  zoneActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 4,
    paddingVertical: 12,
  },
  zoneActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  listenBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.4,
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenBtnActive: {
    backgroundColor: colors.gold,
  },
  stopGlyph: {
    width: 10,
    height: 10,
    backgroundColor: '#1a1612',
    borderRadius: 1.5,
  },
  zoneAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  zoneActionIcon: {
    fontFamily: fonts.displayBold,
    fontSize: 11,
    color: colors.gold,
    letterSpacing: 0.5,
  },
  zoneActionText: {
    fontFamily: fonts.displaySemibold,
    fontSize: 13,
    color: colors.text,
    letterSpacing: 0.3,
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

  // Goal nudge card
  goalNudge: {
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 14,
    padding: 16,
    paddingRight: 36,
    marginBottom: 16,
    position: 'relative',
  },
  goalNudgeHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 8,
  },
  goalNudgeHeaderSuffix: {
    fontFamily: fonts.italic,
    fontSize: 13,
    color: colors.muted,
  },
  goalNudgeBody: {
    fontFamily: fonts.italic,
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  goalNudgeDismiss: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalNudgeDismissText: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.muted,
    lineHeight: 18,
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
    color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 15, letterSpacing: 0.2,
  },
  emptyHint: {
    fontFamily: fonts.displayItalic,
    fontSize: 13, color: colors.dim, alignSelf: 'center',
  },

  // Shared
  goldBtn: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center' },
  goldBtnText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 16 },
  });
}
