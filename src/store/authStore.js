import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setTokens, clearTokens } from '../api';
import { requestPermissions, scheduleSessionReminders } from '../notifications';
import { getLocalDateISO, getYesterdayISO } from '../utils/localDate';

const AUTH_KEY = 'livenew:auth';
const PROFILE_KEY = 'livenew:profile';
const PLAN_KEY = 'livenew:plan';
const SKIPPED_KEY = 'livenew:skipped_date';

export const useAuthStore = create((set, get) => ({
  // State
  isLoading: true,
  isLoggedIn: false,
  isSubscribed: false,
  hasProfile: false,
  profile: null,
  todayPlan: null,       // { rightNow, plan, goalThread, stressRelief, eveningPrompt }
  todayStress: null,
  todaySleep: null,
  todayEnergy: null,
  todayDate: null,
  completed: {},         // { 0: true, 2: true } — which plan items the user has acknowledged
  reflection: null,      // "better" | "same" | "harder" | null
  streak: 0,
  stressHistory: [],
  skippedDate: null,     // YYYY-MM-DD when user chose "skip" today; cleared on day change

  // Hydrate from storage
  hydrate: async () => {
    try {
      const [authJson, profileJson, planJson, skippedJson] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(PLAN_KEY),
        AsyncStorage.getItem(SKIPPED_KEY),
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
            todaySleep = plan.sleepQuality;
            todayEnergy = plan.energy;
            todayDate = plan.date;
            completed = plan.completed || {};
            reflection = plan.reflection || null;
          }
        }

        // Skip flag: only honor if it's for today's local date.
        let skippedDate = null;
        if (skippedJson) {
          const today = getLocalDateISO();
          const stored = JSON.parse(skippedJson);
          if (stored === today) skippedDate = stored;
        }

        set({
          isLoading: false,
          isLoggedIn: true,
          isSubscribed,
          hasProfile,
          profile,
          todayPlan,
          todayStress,
          todaySleep,
          todayEnergy,
          todayDate,
          completed,
          reflection,
          skippedDate,
        });
        get().loadStreak();

        // Refresh profile from server in background
        try {
          const bootstrap = await api.bootstrap();
          const serverProfile = bootstrap?.profile || {};
          if (serverProfile.goal) {
            const normalized = {
              routine: serverProfile.routine || null,
              goal: serverProfile.goal || null,
              stressSource: serverProfile.stressSource || null,
              wakeTime: serverProfile.wakeTime || null,
              timeMin: serverProfile.timeMin || null,
              injuries: serverProfile.injuries || [],
            };
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
            const refreshedHasProfile = !!(normalized.routine && normalized.goal) || !!(normalized.goal && normalized.goal !== 'all');
            set({ profile: normalized, hasProfile: refreshedHasProfile });
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

  // Generate day plan — called after the 3-step check-in
  generatePlan: async ({ stress, sleepQuality, energy }) => {
    const profile = get().profile || {};
    const stressMap = { good: 2, okay: 5, stressed: 8, overwhelmed: 10 };
    const stressValue = stressMap[stress] || (typeof stress === 'number' ? stress : 5);

    const data = await api.checkin({
      dateISO: getLocalDateISO(),
      stress: stressValue,
      sleepQuality,   // "great" | "okay" | "rough"
      energy,         // "high" | "medium" | "low"
      routine: profile.routine || '',
      goal: profile.goal || '',
    });

    // Validate the response actually contains a plan
    if (!data || data.ok === false || !data.plan || !Array.isArray(data.plan) || data.plan.length === 0) {
      throw new Error('Plan generation failed. Please try again.');
    }

    const today = getLocalDateISO();
    const plan = {
      date: today,
      contract: data,     // { rightNow, plan, goalThread, stressRelief, eveningPrompt }
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
      todaySleep: sleepQuality,
      todayEnergy: energy,
      todayDate: today,
      completed: {},
      reflection: null,
    });

    // Increment plan count for trial tracking
    try {
      const countRaw = await AsyncStorage.getItem('livenew:plan_count');
      const count = countRaw ? parseInt(countRaw, 10) : 0;
      await AsyncStorage.setItem('livenew:plan_count', (count + 1).toString());
    } catch {}

    // Schedule notifications for plan items
    try {
      const granted = await requestPermissions();
      if (granted && data?.plan) {
        await scheduleSessionReminders(data.plan);
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
    try {
      const raw = await AsyncStorage.getItem(PLAN_KEY);
      if (raw) {
        const plan = JSON.parse(raw);
        plan.reflection = feeling;
        await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
      }
    } catch {}
    // Send to server (fire and forget)
    try {
      api.reflect({
        feeling,
        dateISO: getLocalDateISO(),
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

  // Logout
  logout: async () => {
    try { await api.logout(); } catch {}
    clearTokens();
    await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_KEY, PLAN_KEY, 'livenew:subscribed', 'livenew:streak', 'livenew:plan_count']);
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      todayPlan: null, todayDate: null, isSubscribed: false,
      completed: {}, reflection: null, streak: 0,
    });
  },

  // Delete account
  deleteAccount: async () => {
    await api.deleteAccount();
    clearTokens();
    await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_KEY, PLAN_KEY, 'livenew:subscribed', 'livenew:streak', 'livenew:plan_count']);
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      todayPlan: null, todayDate: null, isSubscribed: false,
      completed: {}, reflection: null, streak: 0,
    });
  },
}));
