import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setTokens, clearTokens } from '../api';
import { requestPermissions, scheduleSessionReminders } from '../notifications';

const AUTH_KEY = 'livenew:auth';
const PROFILE_KEY = 'livenew:profile';
const PLAN_KEY = 'livenew:plan';

export const useAuthStore = create((set, get) => ({
  // State
  isLoading: true,
  isLoggedIn: false,
  isSubscribed: false,
  hasProfile: false,
  profile: null,
  todayPlan: null,
  todayStress: null,
  todayDate: null,
  streak: 0,
  stressHistory: [],

  // Hydrate from storage
  hydrate: async () => {
    try {
      const [authJson, profileJson, planJson] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(PLAN_KEY),
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
        let todayDate = null;
        if (planJson) {
          const plan = JSON.parse(planJson);
          const today = new Date().toISOString().slice(0, 10);
          if (plan.date === today) {
            todayPlan = plan.contract;
            todayStress = plan.stress;
            todayDate = plan.date;
          }
        }

        set({
          isLoading: false,
          isLoggedIn: true,
          isSubscribed,
          hasProfile,
          profile,
          todayPlan,
          todayStress,
          todayDate,
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
      // Check for new onboarding (routine + goal) OR old onboarding (goal as category)
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
    return data; // May need email confirmation
  },

  setSubscribed: async (value) => {
    try {
      await AsyncStorage.setItem('livenew:subscribed', JSON.stringify(value));
    } catch {}
    set({ isSubscribed: value });
  },

  // Save onboarding profile
  saveProfile: async (profile) => {
    await api.onboardComplete(profile);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    // Clear today's plan so next check-in uses updated profile
    await AsyncStorage.removeItem(PLAN_KEY);
    set({ hasProfile: true, profile, todayPlan: null, todayDate: null });
  },

  // Generate day plan
  generatePlan: async (stress) => {
    const profile = get().profile || {};
    const stressMap = { good: 2, okay: 5, stressed: 8, overwhelmed: 10 };
    const stressValue = stressMap[stress] || (typeof stress === 'number' ? stress : 5);

    // Load stress history
    let stressHistory = [];
    try {
      const histRaw = await AsyncStorage.getItem('livenew:stress_history');
      if (histRaw) stressHistory = JSON.parse(histRaw);
    } catch {}

    const data = await api.checkin({
      dateISO: new Date().toISOString().slice(0, 10),
      stress: stressValue,
      routine: profile.routine || '',
      goal: profile.goal || '',
      stressHistory: stressHistory.slice(-7),
    });

    const today = new Date().toISOString().slice(0, 10);
    const plan = {
      date: today,
      contract: data,
      stress: stressValue,
      completedSessions: {},
    };

    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    set({ todayPlan: data, todayStress: stressValue, todayDate: today });

    // Increment plan count for trial tracking
    try {
      const countRaw = await AsyncStorage.getItem('livenew:plan_count');
      const count = countRaw ? parseInt(countRaw, 10) : 0;
      await AsyncStorage.setItem('livenew:plan_count', (count + 1).toString());
    } catch {}

    // Schedule notifications for sessions
    try {
      const granted = await requestPermissions();
      if (granted && data?.sessions) {
        await scheduleSessionReminders(data.sessions);
      }
    } catch {}

    // Save to stress history
    try {
      stressHistory.push({ date: today, stress: stressValue });
      // Keep last 14 days
      if (stressHistory.length > 14) stressHistory = stressHistory.slice(-14);
      await AsyncStorage.setItem('livenew:stress_history', JSON.stringify(stressHistory));
      set({ stressHistory });
    } catch {}

    get().incrementStreak();
    return data;
  },

  loadStreak: async () => {
    try {
      const raw = await AsyncStorage.getItem('livenew:streak');
      if (raw) {
        const data = JSON.parse(raw);
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        
        if (data.lastDate === today) {
          set({ streak: data.count });
        } else if (data.lastDate === yesterday) {
          // Streak continues but not incremented yet today
          set({ streak: data.count });
        } else {
          // Streak broken
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
      const today = new Date().toISOString().slice(0, 10);
      
      if (data.lastDate === today) return; // Already counted today
      
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const newCount = data.lastDate === yesterday ? data.count + 1 : 1;
      
      await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: newCount, lastDate: today }));
      set({ streak: newCount });
    } catch {}
  },

  // Mark session complete
  completeSession: async (type) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (type === 'move') await api.completeMove(today);
      else if (type === 'reset') await api.completeReset(today);
      else if (type === 'winddown') await api.completeWinddown(today);
    } catch {}

    // Update local plan
    const planJson = await AsyncStorage.getItem(PLAN_KEY);
    if (planJson) {
      const plan = JSON.parse(planJson);
      if (type === 'move') plan.moveCompleted = true;
      else if (type === 'reset') plan.resetCompleted = true;
      else if (type === 'winddown') plan.winddownCompleted = true;
      await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plan));

      set((prev) => ({
        todayPlan: {
          ...prev.todayPlan,
          [`${type}Completed`]: true,
        },
      }));
    }
  },

  // Logout
  logout: async () => {
    try { await api.logout(); } catch {}
    clearTokens();
    await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_KEY, PLAN_KEY]);
    await AsyncStorage.removeItem('livenew:subscribed');
    set({ isLoggedIn: false, hasProfile: false, profile: null, todayPlan: null, isSubscribed: false });
  },

  // Delete account
  deleteAccount: async () => {
    await api.deleteAccount();
    clearTokens();
    await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_KEY, PLAN_KEY]);
    await AsyncStorage.removeItem('livenew:subscribed');
    set({ isLoggedIn: false, hasProfile: false, profile: null, todayPlan: null, isSubscribed: false });
  },
}));
