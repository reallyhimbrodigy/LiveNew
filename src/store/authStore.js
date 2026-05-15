import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setTokens, clearTokens, setAuthExpiredHandler } from '../api';
import { requestPermissions, scheduleSessionReminders } from '../notifications';
import { getLocalDateISO, getYesterdayISO } from '../utils/localDate';
import {
  isHealthAvailable,
  getHealthPermissionStatus,
  setHealthPermissionStatus,
  requestHealthPermissions,
  getHealthSnapshot,
} from '../healthkit';

const AUTH_KEY = 'livenew:auth';
const PROFILE_KEY = 'livenew:profile';
const PLAN_KEY = 'livenew:plan';
const SKIPPED_KEY = 'livenew:skipped_date';
const NAME_KEY = 'livenew:user_name';

export const useAuthStore = create((set, get) => ({
  // State
  isLoading: true,
  isLoggedIn: false,
  isSubscribed: false,
  hasProfile: false,
  profile: null,
  todayPlan: null,       // { rightNow, plan, goalThread, stressRelief, eveningPrompt }
  todayStress: null,
  todayStressLabel: null,
  todaySleep: null,
  todayEnergy: null,
  todayDate: null,
  completed: {},         // { 0: true, 2: true } — which plan items the user has acknowledged
  reflection: null,      // "better" | "same" | "harder" | null
  streak: 0,
  stressHistory: [],
  skippedDate: null,     // YYYY-MM-DD when user chose "skip" today; cleared on day change
  healthPermission: 'unknown', // "granted" | "denied" | "unknown"
  healthSnapshot: null,        // cached HealthKit summary, refreshed on app focus
  userName: null,              // first name (captured at signup, persisted locally)

  // Hydrate from storage
  hydrate: async () => {
    try {
      const [authJson, profileJson, planJson, skippedJson, nameJson] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(PLAN_KEY),
        AsyncStorage.getItem(SKIPPED_KEY),
        AsyncStorage.getItem(NAME_KEY),
      ]);

      if (authJson) {
        const auth = JSON.parse(authJson);
        setTokens(auth.accessToken, auth.refreshToken);
        // Check subscription
        let isSubscribed = false;
        try {
          const subRaw = await AsyncStorage.getItem('livenew:subscribed');
          if (subRaw) isSubscribed = JSON.parse(subRaw);
        } catch {}

        let profile = null;
        let hasProfile = false;
        if (profileJson) {
          profile = JSON.parse(profileJson);
          hasProfile = !!(profile && profile.routine && profile.goal) || !!(profile && profile.goal && profile.goal !== 'all');
        }

        // Check if we have a valid plan for today
        let todayPlan = null;
        let todayStress = null;
        let todayStressLabel = null;
        let todaySleep = null;
        let todayEnergy = null;
        let todayDate = null;
        let completed = {};
        let reflection = null;
        if (planJson) {
          const plan = JSON.parse(planJson);
          const today = getLocalDateISO();
          if (plan.date === today) {
            todayPlan = plan.contract;
            todayStress = plan.stress;
            todayStressLabel = plan.stressLabel || null;
            todaySleep = plan.sleepQuality;
            todayEnergy = plan.energy;
            todayDate = plan.date;
            completed = plan.completed || {};
            reflection = plan.reflection || null;
          } else {
            // Stale cached plan from a previous day — purge it so we don't
            // hand stale data to the rest of the app on a slow day-roll.
            try { await AsyncStorage.removeItem(PLAN_KEY); } catch {}
          }
        }

        // Skip flag: only honor if it's for today's local date.
        let skippedDate = null;
        if (skippedJson) {
          const today = getLocalDateISO();
          const stored = JSON.parse(skippedJson);
          if (stored === today) skippedDate = stored;
        }

        // HealthKit permission status is persisted; we read it here so the
        // UI can decide whether to show the "Connect Apple Health" banner.
        let healthPermission = 'unknown';
        try { healthPermission = await getHealthPermissionStatus(); } catch {}

        set({
          isLoading: false,
          isLoggedIn: true,
          isSubscribed,
          hasProfile,
          profile,
          userName: nameJson || null,
          todayPlan,
          todayStress,
          todayStressLabel,
          todaySleep,
          todayEnergy,
          todayDate,
          completed,
          reflection,
          skippedDate,
          healthPermission,
        });
        get().loadStreak();
        // If we already have permission, refresh the health snapshot in the
        // background so the score and AI prompt have fresh data.
        if (healthPermission === 'granted') {
          get().refreshHealthSnapshot().catch(() => {});
        }

        // Refresh profile from server in background — MERGE not clobber. The
        // server response may not include every field (e.g. server only stores
        // goal + routine; the client may have stored extras like injuries
        // from an older session). Don't overwrite local fields with server
        // null/undefined.
        try {
          const bootstrap = await api.bootstrap();
          const serverProfile = bootstrap?.profile || {};
          if (serverProfile.goal) {
            const localProfile = profile || {};
            const pickServer = (key) => (
              serverProfile[key] !== undefined && serverProfile[key] !== null
                ? serverProfile[key]
                : localProfile[key] !== undefined
                  ? localProfile[key]
                  : null
            );
            const merged = {
              routine: pickServer('routine'),
              goal: pickServer('goal'),
              stressSource: pickServer('stressSource'),
              wakeTime: pickServer('wakeTime'),
              timeMin: pickServer('timeMin'),
              injuries: serverProfile.injuries || localProfile.injuries || [],
            };
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
            const refreshedHasProfile = !!(merged.routine && merged.goal) || !!(merged.goal && merged.goal !== 'all');
            set({ profile: merged, hasProfile: refreshedHasProfile });
          }
        } catch {}

        // Verify subscription with RevenueCat
        try {
          const { checkSubscription } = require('../purchases');
          const active = await checkSubscription();
          if (active !== get().isSubscribed) {
            set({ isSubscribed: active });
            await AsyncStorage.setItem('livenew:subscribed', JSON.stringify(active));
          }
        } catch {}

        return;
      }
    } catch {}

    set({ isLoading: false, isLoggedIn: false });
  },

  // Login
  login: async (email, password) => {
    const data = await api.login(email, password);
    const auth = {
      accessToken: data.accessToken || data.token,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));

    // Fetch profile
    try {
      const bootstrap = await api.bootstrap();
      const p = bootstrap?.profile || {};
      const profile = {
        routine: p.routine || null,
        goal: p.goal || null,
        stressSource: p.stressSource || null,
        wakeTime: p.wakeTime || null,
        timeMin: p.timeMin || null,
        injuries: p.injuries || [],
      };
      const hasProfile = !!(profile.routine && profile.goal) || !!(profile.goal && profile.goal !== 'all');
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      set({ isLoggedIn: true, hasProfile, profile });
    } catch {
      set({ isLoggedIn: true, hasProfile: false });
    }
  },

  // Signup
  signup: async (email, password, name) => {
    const data = await api.signup(email, password, name);
    // Server doesn't store the name yet — persist locally so we can use it
    // in greetings + Iris-voiced moments. First name only for natural copy.
    if (name && typeof name === 'string') {
      const first = name.trim().split(/\s+/)[0] || null;
      if (first) {
        try { await AsyncStorage.setItem(NAME_KEY, first); } catch {}
        set({ userName: first });
      }
    }
    return data;
  },

  // User chose to skip today's check-in. Persists for today only; cleared on day change.
  skipToday: async () => {
    const today = getLocalDateISO();
    set({ skippedDate: today });
    try { await AsyncStorage.setItem(SKIPPED_KEY, JSON.stringify(today)); } catch {}
  },

  // Clear the skip flag (called when user starts the check-in flow).
  clearSkip: async () => {
    set({ skippedDate: null });
    try { await AsyncStorage.removeItem(SKIPPED_KEY); } catch {}
  },

  // HealthKit — request permissions, refresh snapshot, persist status.
  // Returns { ok, error } so the UI can surface failures instead of silently
  // doing nothing (the bug in build #35).
  connectHealth: async () => {
    const available = await isHealthAvailable();
    if (!available) {
      set({ healthPermission: 'denied' });
      await setHealthPermissionStatus('denied');
      return { ok: false, error: 'HealthKit not available on this device.' };
    }
    const result = await requestHealthPermissions();
    if (!result.ok) {
      set({ healthPermission: 'denied' });
      return result;
    }
    const snapshot = await getHealthSnapshot({ maxAgeMinutes: 0 });
    // If we got any biometric data back, the user clearly granted something —
    // mark granted directly so the UI updates immediately.
    const anyData = snapshot && (
      snapshot.sleepLast7Avg != null ||
      snapshot.rhrLast7Avg != null ||
      snapshot.hrvLast7Avg != null ||
      snapshot.stepsYesterday != null
    );
    const status = anyData ? 'granted' : (await getHealthPermissionStatus());
    if (anyData) await setHealthPermissionStatus('granted');
    set({ healthPermission: status, healthSnapshot: snapshot });
    return { ok: true, error: null };
  },

  // Refresh the cached health snapshot (called on app focus / Today mount).
  refreshHealthSnapshot: async () => {
    const status = await getHealthPermissionStatus();
    if (status !== 'granted') return null;
    const snapshot = await getHealthSnapshot({ maxAgeMinutes: 30 });
    if (snapshot) set({ healthSnapshot: snapshot });
    return snapshot;
  },

  setSubscribed: async (value) => {
    try {
      await AsyncStorage.setItem('livenew:subscribed', JSON.stringify(value));
    } catch {}
    set({ isSubscribed: value });
  },

  // Save onboarding profile (sets hasProfile, triggers navigation to MainTabs)
  saveProfile: async (profile) => {
    await api.onboardComplete(profile);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    await AsyncStorage.removeItem(PLAN_KEY);
    set({ hasProfile: true, profile, todayPlan: null, todayDate: null, completed: {}, reflection: null });
  },

  // Save profile WITHOUT triggering navigation — used during onboarding
  // so we can save profile + generate plan before flipping to MainTabs
  saveProfileWithoutNav: async (profile) => {
    // Accept consent first (required before any other server calls work)
    await api.acceptConsent();
    await api.onboardComplete(profile);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    await AsyncStorage.removeItem(PLAN_KEY);
    set({ profile, todayPlan: null, todayDate: null, completed: {}, reflection: null });
  },

  // Flip hasProfile to trigger navigation to MainTabs
  activateProfile: () => {
    set({ hasProfile: true });
  },

  // Save routine upgrade (after user has seen their first plan and wants personalization)
  saveRoutine: async (routine) => {
    const profile = { ...get().profile, routine };
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    set({ profile });
    // Fire and forget to server
    try { api.onboardComplete(profile); } catch {}
  },

  // Generate day plan — called after the 3-step check-in (stress + sleep + energy)
  generatePlan: async ({ stress, sleepQuality, energy }) => {
    // Paywall gate: 7 free plans (one per distinct day). After that, free
    // users must subscribe before generating a new plan. We throw a typed
    // error so the calling screen can route to the Paywall instead of
    // showing a generic "something went wrong" message.
    if (!get().isSubscribed) {
      try {
        const countRaw = await AsyncStorage.getItem('livenew:plan_count');
        const count = countRaw ? parseInt(countRaw, 10) : 0;
        if (count >= 7) {
          const err = new Error('Free trial complete — subscribe to keep generating plans.');
          err.code = 'PAYWALL_REQUIRED';
          throw err;
        }
      } catch (err) {
        if (err?.code === 'PAYWALL_REQUIRED') throw err;
        // Other AsyncStorage errors — don't block the user.
      }
    }

    const profile = get().profile || {};
    const stressMap = { good: 2, okay: 5, stressed: 8, overwhelmed: 10 };
    const stressValue = stressMap[stress] || (typeof stress === 'number' ? stress : 5);
    // Send the user's chosen LABEL ("good"/"okay"/"stressed"/"overwhelmed")
    // so the server can pass it verbatim to the AI prompt. The numeric value
    // is also sent so the server can store it for stress-trend purposes.
    const stressLabel = typeof stress === 'string' ? stress : null;

    // If HealthKit is connected, attach the latest snapshot so the server
    // can pass it to the AI. Refresh inline (cheap if cached) so we don't
    // ship stale data.
    let healthSnapshot = null;
    if (get().healthPermission === 'granted') {
      try {
        healthSnapshot = await getHealthSnapshot({ maxAgeMinutes: 30 });
      } catch {}
    }

    const data = await api.checkin({
      dateISO: getLocalDateISO(),
      stress: stressValue,
      stressLabel,
      sleepQuality,   // "great" | "okay" | "rough"
      energy,         // "high" | "medium" | "low"
      routine: profile.routine || '',
      goal: profile.goal || '',
      healthSnapshot, // null if not connected; server handles either way
    });

    // New schema: validate zones[]. Backward-compat: still accept old plan[]
    // for users mid-migration but treat absence of zones as a failure for new
    // generations.
    const hasZones = data && Array.isArray(data.zones) && data.zones.length > 0;
    const hasLegacyPlan = data && Array.isArray(data.plan) && data.plan.length > 0;
    if (!data || data.ok === false || (!hasZones && !hasLegacyPlan)) {
      throw new Error('Plan generation failed. Please try again.');
    }

    const today = getLocalDateISO();
    const plan = {
      date: today,
      contract: data,     // { zones, goalThread, stressRelief, eveningPrompt }
      stress: stressValue,
      sleepQuality,
      energy,
      completed: {},
      reflection: null,
    };

    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    set({
      todayPlan: data,
      todayStress: stressValue,
      todayStressLabel: stressLabel,
      todaySleep: sleepQuality,
      todayEnergy: energy,
      todayDate: today,
      completed: {},
      reflection: null,
    });

    // Increment plan count for trial tracking — but only ONCE per day, even
    // if the user re-runs the check-in. Same-day regenerations shouldn't
    // count against any plan/quota limit.
    try {
      const lastDay = await AsyncStorage.getItem('livenew:plan_count_last_day');
      if (lastDay !== today) {
        const countRaw = await AsyncStorage.getItem('livenew:plan_count');
        const count = countRaw ? parseInt(countRaw, 10) : 0;
        await AsyncStorage.setItem('livenew:plan_count', (count + 1).toString());
        await AsyncStorage.setItem('livenew:plan_count_last_day', today);
      }
    } catch {}

    // Schedule notifications at the inflection-point zones (mid-morning dip,
    // afternoon dip, wind-down) — not one per item like the old plan format.
    try {
      const granted = await requestPermissions();
      if (granted && hasZones) {
        await scheduleSessionReminders(data.zones);
      }
    } catch {}

    get().incrementStreak();
    return data;
  },

  // Mark a plan item as acknowledged ("Got it")
  markDone: async (index) => {
    const newCompleted = { ...get().completed, [index]: true };
    set({ completed: newCompleted });
    try {
      const raw = await AsyncStorage.getItem(PLAN_KEY);
      if (raw) {
        const plan = JSON.parse(raw);
        plan.completed = newCompleted;
        await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
      }
    } catch {}
    // Report completion to server so progress tracking works
    try {
      const planItems = get().todayPlan?.plan || [];
      const item = planItems[index];
      api.feedback({
        type: 'item_completed',
        dateISO: getLocalDateISO(),
        sessionIndex: index,
        interventionType: item?.type || 'unknown',
      }).catch(() => {});
    } catch {}
  },

  // Submit evening reflection
  submitReflection: async (feeling) => {
    set({ reflection: feeling });
    const today = getLocalDateISO();
    try {
      const raw = await AsyncStorage.getItem(PLAN_KEY);
      if (raw) {
        const plan = JSON.parse(raw);
        plan.reflection = feeling;
        await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
      }
    } catch {}
    // Persist reflection date-keyed so Today can show the "yesterday felt X"
    // callout tomorrow morning — the user sees that Iris is actually using
    // their input, closing the feedback loop visibly.
    try { await AsyncStorage.setItem(`livenew:reflection:${today}`, feeling); } catch {}
    // Send to server (fire and forget)
    try {
      api.reflect({
        feeling,
        dateISO: today,
        completed: get().completed,
      }).catch(() => {});
    } catch {}
  },

  loadStreak: async () => {
    try {
      const raw = await AsyncStorage.getItem('livenew:streak');
      if (raw) {
        const data = JSON.parse(raw);
        const today = getLocalDateISO();
        const yesterday = getYesterdayISO();

        if (data.lastDate === today) {
          set({ streak: data.count });
        } else if (data.lastDate === yesterday) {
          set({ streak: data.count });
        } else {
          set({ streak: 0 });
          await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: 0, lastDate: null }));
        }
      }
    } catch {}
  },

  incrementStreak: async () => {
    try {
      const raw = await AsyncStorage.getItem('livenew:streak');
      const data = raw ? JSON.parse(raw) : { count: 0, lastDate: null };
      const today = getLocalDateISO();

      if (data.lastDate === today) return;

      const yesterday = getYesterdayISO();
      const newCount = data.lastDate === yesterday ? data.count + 1 : 1;

      await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: newCount, lastDate: today }));
      set({ streak: newCount });
    } catch {}
  },

  // Logout — clears EVERY per-user AsyncStorage key plus the widget payload.
  // Missing any one of these means the next user inherits state from the
  // previous user.
  logout: async () => {
    try { await api.logout(); } catch {}
    clearTokens();
    await AsyncStorage.multiRemove([
      AUTH_KEY, PROFILE_KEY, PLAN_KEY, NAME_KEY,
      'livenew:subscribed', 'livenew:streak', 'livenew:plan_count',
      'livenew:plan_count_last_day', 'livenew:first_plan_at',
      'livenew:notif_prefs_v1', 'livenew:notif_permission',
      'livenew:goal_nudge_dismissed', 'livenew:share_card_variant',
      'livenew:lastCelebratedStreak', 'livenew:goal_set_at',
      'livenew:progress_cache_v1', 'livenew:health_snapshot_v1',
      'livenew:health_permission_status', 'livenew:review_prompted',
      'livenew:streak_risk_dismissed',
    ]);
    try {
      const { clearWidgetPayload } = require('../widgetBridge');
      await clearWidgetPayload();
    } catch {}
    try {
      const { clearAllZoneNotifications } = require('../notifications');
      await clearAllZoneNotifications();
    } catch {}
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      userName: null,
      todayPlan: null, todayDate: null, todayStress: null, todayStressLabel: null,
      todaySleep: null, todayEnergy: null, isSubscribed: false,
      completed: {}, reflection: null, streak: 0,
      healthPermission: 'unknown', healthSnapshot: null,
    });
  },

  // Delete account — same cleanup as logout, plus server-side delete.
  deleteAccount: async () => {
    await api.deleteAccount();
    clearTokens();
    await AsyncStorage.multiRemove([
      AUTH_KEY, PROFILE_KEY, PLAN_KEY, NAME_KEY,
      'livenew:subscribed', 'livenew:streak', 'livenew:plan_count',
      'livenew:plan_count_last_day', 'livenew:first_plan_at',
      'livenew:notif_prefs_v1', 'livenew:notif_permission',
      'livenew:goal_nudge_dismissed', 'livenew:share_card_variant',
      'livenew:lastCelebratedStreak', 'livenew:goal_set_at',
      'livenew:progress_cache_v1', 'livenew:health_snapshot_v1',
      'livenew:health_permission_status', 'livenew:review_prompted',
      'livenew:streak_risk_dismissed',
    ]);
    try {
      const { clearWidgetPayload } = require('../widgetBridge');
      await clearWidgetPayload();
    } catch {}
    try {
      const { clearAllZoneNotifications } = require('../notifications');
      await clearAllZoneNotifications();
    } catch {}
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      userName: null,
      todayPlan: null, todayDate: null, todayStress: null, todayStressLabel: null,
      todaySleep: null, todayEnergy: null, isSubscribed: false,
      completed: {}, reflection: null, streak: 0,
      healthPermission: 'unknown', healthSnapshot: null,
    });
  },
}));

// Wire api.js -> authStore: when the refresh-token flow fails, force a
// full logout so the user lands on AuthScreen instead of a zombie session.
setAuthExpiredHandler(() => {
  try { useAuthStore.getState().logout(); } catch {}
});
