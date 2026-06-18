import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setTokens, clearTokens, setAuthExpiredHandler } from '../api';
import { normalizeSchedule, deriveRoutineSummary } from '../domain/schedule.js';
import {
  requestPermissions,
  scheduleSessionReminders,
  scheduleCheckInReminders,
  clearStaleZoneNotificationsIfNoPlanToday,
  migrateLegacyZoneNotifications,
} from '../notifications';
import { getLocalDateISO, getYesterdayISO, getDayBeforeYesterdayISO, getWeekIdISO, getLogicalDateISO, isSleepWindow } from '../utils/localDate';
import { resolveStreakOnLoad, classifyStreakOnLoad, freezeCooldownDaysLeft } from '../domain/streak.js';
import { earnedGems } from '../domain/gems.js';
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
const EMAIL_KEY = 'livenew:user_email';
// Device-local selected aura id (recolors the app accent + bg tint). Empty
// string means "no aura → default gold". Cleared on logout like NAME_KEY.
const SELECTED_AURA_KEY = 'livenew:selected_aura';

// Account-scoped "this user has finished onboarding on this device" marker.
// CRITICAL: this is keyed by userId and is deliberately NOT cleared on logout.
// It lets us recognize a returning user as already-onboarded even when the
// bootstrap call fails (offline / server hiccup) right after they sign back
// in — without it, the only offline signal was PROFILE_KEY, which logout
// wipes, so a flaky network on re-login dumped returning users back into
// onboarding. A bare boolean keyed by userId leaks nothing to a different
// account that later signs in on the same device (their userId differs).
const onboardedMarkerKey = (userId) => (userId ? `livenew:onboarded:${userId}` : null);

// Account-scoped, survives logout (the collection is permanent). Stores the
// highest streak ever reached + the date each gem was first earned.
const gemsKey = (userId) => (userId ? `livenew:gems:${userId}` : 'livenew:gems');

// Account-scoped profile picture URI. Mirrors gemsKey — keyed by userId so a
// second account on the same device never inherits the first user's avatar.
// Survives logout (account-scoped); removed on deleteAccount.
const avatarKey = (userId) => (userId ? `livenew:avatar:${userId}` : 'livenew:avatar');

// Account-scoped streak-freeze ledger. Stores { lastUsedAt: 'YYYY-MM-DD' } — the
// day the user last spent a freeze. Free tier: one save, then a 7-day rolling
// cooldown (freezeCooldownDaysLeft). Premium ignores the cooldown (save anytime).
// Survives logout (like gems) so a re-login doesn't reset the cooldown; removed
// on deleteAccount alongside gems. (Older builds stored { lastUsedWeek }; that
// key is simply ignored now, which at worst grants one immediate save.)
const streakFreezeKey = (userId) => (userId ? `livenew:streakfreeze:${userId}` : null);
const writeOnboardedMarker = async (userId) => {
  const key = onboardedMarkerKey(userId);
  if (!key) return;
  try { await AsyncStorage.setItem(key, '1'); } catch {}
};
const readOnboardedMarker = async (userId) => {
  const key = onboardedMarkerKey(userId);
  if (!key) return false;
  try { return (await AsyncStorage.getItem(key)) === '1'; } catch { return false; }
};

// Persist the user's email locally so Account can show it (read-only). Email
// isn't in the durable auth payload; capture it at sign-in. Device-local, not
// account-scoped — cleared on logout like NAME_KEY.
const persistEmail = async (email, set) => {
  const e = (email || '').trim();
  if (!e) return;
  try { await AsyncStorage.setItem(EMAIL_KEY, e); } catch {}
  set({ userEmail: e });
};

// Normalize schedule and derive a back-compat routine summary when a schedule
// is present (keeps the hasProfile gate satisfied). Returns the profile
// unchanged when no schedule is set. Used by both save paths.
// Resolve the device's IANA timezone (e.g. "America/New_York"). Used so the
// server can derive the plan's time-of-day from the user's real local time
// instead of falling back to the server clock / LA default — that fallback was
// the source of "good morning at night" for users outside LA.
function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function prepareProfileForSave(profile) {
  // Always stamp the current device timezone so it's persisted server-side and
  // the day plan's time-of-day matches the user's real local time. Stamped even
  // when there's no schedule (early-return path below) so it's never dropped.
  const deviceTimezone = getDeviceTimezone();
  const withTz = deviceTimezone ? { ...profile, timezone: deviceTimezone } : profile;
  if (!withTz.schedule) return withTz;
  const schedule = normalizeSchedule(withTz.schedule);
  // Always set a non-empty routine so the hasProfile gate (!!profile.routine)
  // passes even when the user skipped (empty schedule). The AI prompt uses the
  // structured schedule (daySchedule) as the primary signal; this string is
  // only the legacy fallback, so a benign sentinel is honest and safe.
  const routine = withTz.routine || deriveRoutineSummary(schedule) || 'No fixed schedule.';
  return { ...withTz, schedule, routine };
}

// App-version gating from the server bootstrap (`appUpdate`). Compares the
// installed NATIVE app version against the server's min/latest so we can show a
// forced "Update required" gate or a soft "Update available" nudge. JS-only
// changes ship via EAS Update (OTA) and never trip this.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
function parseAppUpdate(bootstrap) {
  const au = bootstrap?.appUpdate;
  if (!au) return null;
  let current = '1.0.0';
  try { current = require('expo-application').nativeApplicationVersion || current; } catch {}
  return {
    required: !!au.min && compareVersions(current, au.min) < 0,
    available: !!au.latest && compareVersions(current, au.latest) < 0,
    storeUrl: au.storeUrl || null,
  };
}

// 14-day free trial helpers — used by both the gate (generatePlan) and the
// UI (Paywall trigger, trial countdown on Account, feature gating elsewhere).
export const TRIAL_DAYS = 7;
export function trialDaysRemaining(trialStartISO) {
  if (!trialStartISO) return TRIAL_DAYS;
  const start = new Date(trialStartISO + 'T00:00:00').getTime();
  if (!Number.isFinite(start)) return 0;
  const elapsedDays = Math.floor((Date.now() - start) / 86400000);
  return Math.max(0, TRIAL_DAYS - elapsedDays);
}
export function isWithinTrial(trialStartISO) {
  return trialDaysRemaining(trialStartISO) > 0;
}

// Premium = paying subscriber OR still within the 7-day trial taste.
// Free users keep the core loop forever; this gate covers depth features only.
export function useIsPremium() {
  const isSubscribed = useAuthStore((s) => s.isSubscribed);
  const isComped = useAuthStore((s) => s.isComped);
  const trialStartISO = useAuthStore((s) => s.trialStartISO);
  return isSubscribed || isComped || isWithinTrial(trialStartISO);
}

export const useAuthStore = create((set, get) => ({
  // State
  isLoading: true,
  isLoggedIn: false,
  isSubscribed: false, isComped: false,
  appUpdate: null, // { required, available, storeUrl } from bootstrap, or null
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
  userEmail: null,             // email (captured at sign-in, persisted locally, read-only display)
  avatarUri: null,             // profile picture URL (server-sourced; cached locally for instant display)
  avatarUploading: false,      // transient: true while an avatar upload is in flight (drives the UI spinner)
  userId: null,                // current account id — scopes per-account device markers
  themeMode: 'system',         // 'system' | 'light' | 'dark' — overrides useColorScheme()
  selectedAuraId: null,        // id of the EARNED aura recoloring the app accent/bg, or null for default gold
  trialStartISO: null,         // ISO date YYYY-MM-DD when the 14-day free trial began
  maxStreak: 0,        // highest streak ever reached — gates permanent gems
  gemEarnedAt: {},     // { [gemId]: 'YYYY-MM-DD' } first-earned dates
  pendingGemUnlock: null, // gemId just crossed this session (for the celebration), else null
  haloStats: null,     // { [day]: pct } live cross-user rarity from /v1/halo-stats, or null
  streakSavedByFreeze: false, // transient: true if a freeze saved the streak this load
  streakFreezeReady: false,   // transient: true if a freeze is available to use now (premium, or free off-cooldown)
  // Pending "you missed a day — save it?" offer, set on load when the streak is
  // saveable. null when there's nothing to decide.
  // { count, saveToDate, eligible, isPremium, cooldownDaysLeft }
  streakFreezeOffer: null,

  // Hydrate from storage
  hydrate: async () => {
    // One-time migration: cancel any per-zone notifications scheduled by
    // older builds with `repeats: true`, which kept firing stale plan
    // content on subsequent mornings. Safe no-op once it's run.
    migrateLegacyZoneNotifications().catch(() => {});

    // Theme preference (light/dark/system) — independent of auth state,
    // load it first so the app paints in the right mode immediately.
    try {
      const m = await AsyncStorage.getItem('livenew:theme_mode');
      if (m === 'light' || m === 'dark' || m === 'system') set({ themeMode: m });
    } catch {}

    // Selected aura (accent/bg recolor) — device-local, independent of auth
    // state, so restore it early alongside the theme so the app paints with the
    // right accent immediately. Empty string / missing → default gold (null).
    try {
      const a = await AsyncStorage.getItem(SELECTED_AURA_KEY);
      set({ selectedAuraId: a || null });
    } catch {}

    try {
      const [authJson, profileJson, planJson, skippedJson, nameJson, emailJson] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
        AsyncStorage.getItem(PLAN_KEY),
        AsyncStorage.getItem(SKIPPED_KEY),
        AsyncStorage.getItem(NAME_KEY),
        AsyncStorage.getItem(EMAIL_KEY),
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
          // Onboarding completion is gated on routine (the schedule) only.
          // Goal was removed — cortisol regulation is the universal lever.
          hasProfile = !!(profile && profile.routine);
        }

        // Check if we have a valid plan for the user's logical day. We use
        // the LOGICAL date (rolls over at 5am, not midnight) so a plan
        // generated at 11pm is still hydrated when the user checks at 3am —
        // they haven't slept yet, the day isn't really over.
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
          const today = getLogicalDateISO();
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
            // Stale cached plan from a previous logical day — purge it so we
            // don't hand stale data to the rest of the app on a slow day-roll.
            try { await AsyncStorage.removeItem(PLAN_KEY); } catch {}
          }
        }

        // Skip flag: only honor if it's for the user's current logical day.
        // Same rationale as plan hydration above — skipping at 11pm shouldn't
        // get cleared at midnight while the user is still up.
        let skippedDate = null;
        if (skippedJson) {
          const today = getLogicalDateISO();
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
          userId: auth.userId || null,
          userName: nameJson || null,
          userEmail: emailJson || null,
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
        get().loadGems();
        get().loadAvatar();
        // Fire-and-forget: fetch live cross-user halo rarity stats.
        // Client falls back to designed rarityPct values if this fails or hasn't
        // resolved yet — never blocks hydrate.
        get().fetchHaloStats().catch(() => {});
        // Initialize trial start if missing — first hydrate after signup
        // sets it to today, giving the user a fresh 14-day window.
        get().ensureTrialStart().catch(() => {});

        // Reconcile notifications based on whether the user has a plan for
        // their current logical day. No plan → cancel any lingering zone
        // notifications AND schedule check-in reminders so the user gets
        // pulled back to the app. Has plan → today's reminders are suppressed.
        const hasPlanToday = !!todayPlan && todayDate === getLogicalDateISO();
        clearStaleZoneNotificationsIfNoPlanToday(hasPlanToday).catch(() => {});
        scheduleCheckInReminders({ hasPlanToday }).catch(() => {});

        // If we already have permission, refresh the health snapshot in the
        // background so the score and AI prompt have fresh data.
        if (healthPermission === 'granted') {
          get().refreshHealthSnapshot().catch(() => {});
        }

        // Refresh profile from server in background — MERGE not clobber. The
        // server response may not include every field (e.g. server only stores
        // goal + routine; the client may have stored extras like injuries
        // from an older session). Don't overwrite local fields with server
        // null/undefined. AND don't downgrade hasProfile on bootstrap failure —
        // a transient network error must NEVER re-onboard a returning user.
        try {
          const bootstrap = await api.bootstrap();
          const serverProfile = bootstrap?.profile || {};
          // Manual comp flag (user_profile.is_pro) — premium alongside
          // RevenueCat + the trial. See useIsPremium / isPremiumNow.
          set({ isComped: serverProfile.isPro === true });
          set({ appUpdate: parseAppUpdate(bootstrap) });
          const serverSaysOnboarded =
            bootstrap?.uiState === 'home' ||
            bootstrap?.profile?.isComplete === true ||
            !!serverProfile.routine;
          // Persist the account-scoped onboarded marker so a later
          // logout→login with a flaky connection still recognizes this user.
          if (serverSaysOnboarded) await writeOnboardedMarker(auth.userId);
          // Sync the avatar from the authoritative server value. Overwrites the
          // local cache loaded by loadAvatar() above with the fresh URL.
          if (serverProfile.avatar_url) {
            set({ avatarUri: serverProfile.avatar_url });
            try { await AsyncStorage.setItem(avatarKey(auth.userId), serverProfile.avatar_url); } catch {}
          }
          if (serverProfile.routine) {
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
              stressSource: pickServer('stressSource'),
              wakeTime: pickServer('wakeTime'),
              timeMin: pickServer('timeMin'),
              injuries: serverProfile.injuries || localProfile.injuries || [],
              schedule: serverProfile.schedule || localProfile.schedule || null,
            };
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
            set({ profile: merged, hasProfile: serverSaysOnboarded || !!merged.routine });
          } else if (serverSaysOnboarded && !hasProfile) {
            // Server flagged this user as onboarded but didn't return a
            // routine in the response shape — still flip the gate so the
            // user isn't trapped in onboarding. This handles older bootstrap
            // responses that omit the field.
            set({ hasProfile: true });
          }
        } catch (err) {
          // Bootstrap failed — keep whatever hasProfile we already set from
          // the local cache above. Do NOT clear it. Returning users with
          // a flaky connection still get into the app.
          console.warn('[auth] hydrate bootstrap failed (keeping local state)', err?.message);
        }

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
    if (!data?.accessToken && !data?.token) throw new Error('Sign-in failed. Please try again.');
    const auth = {
      accessToken: data.accessToken || data.token,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    await persistEmail(email, set);

    await get().postSignInBootstrap();
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

  // Verify the 6-digit signup code from the confirmation email. Returns the
  // same shape as login on success: sets the access/refresh tokens, runs the
  // bootstrap to load the profile, and flips isLoggedIn so the navigator
  // moves the user past Auth. Throws on bad/expired code so the UI can show
  // a targeted error and the Resend prompt.
  verifySignupOtp: async (email, code) => {
    const data = await api.verifySignupOtp(email, code);
    if (!data?.accessToken) throw new Error('Sign-in failed. Please try again.');
    const auth = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    await persistEmail(email, set);
    await get().postSignInBootstrap();
    return data;
  },

  // Re-send the signup OTP. Returns void; throws if Supabase rejects.
  resendSignupOtp: async (email) => {
    await api.resendSignupOtp(email);
  },

  // ===== Passwordless flow (primary path) =====
  //
  // sendOtp: ask Supabase to email a 6-digit code. Works for both new and
  // returning users because signInWithOtp creates the user if missing.
  // Throws so the UI can show a rate-limit / invalid-email error.
  sendOtp: async (email) => {
    await api.sendOtp(email);
  },

  // verifyOtp: verify the code, store tokens, bootstrap profile, flip
  // isLoggedIn so the navigator advances past Auth. Same end-state as the
  // password-based login path — caller can treat this as "log the user in."
  verifyOtp: async (email, code) => {
    const data = await api.verifyOtp(email, code);
    if (!data?.accessToken) throw new Error('Sign-in failed. Please try again.');
    const auth = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    await persistEmail(email, set);
    await get().postSignInBootstrap();
    return data;
  },

  // Sign in with Apple (iOS native). Returns the same shape as verifyOtp on
  // success. Throws on cancel/error so the UI can show or swallow it.
  //
  // Flow: generate a nonce → hash it → ask Apple for an identityToken with
  // that hash → Apple returns the token (containing the hash inside) →
  // send the original nonce + token to our server → server hands both to
  // Supabase which verifies the nonce matches and returns a session.
  signInWithApple: async () => {
    const AppleAuth = require('expo-apple-authentication');
    const Crypto = require('expo-crypto');
    // Generate a random nonce and its SHA-256 hash. Apple gets the hash,
    // Supabase gets the raw nonce — both have to agree the token is fresh.
    const rawNonce = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 36).toString(36)).join('');
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuth.signInAsync({
      requestedScopes: [
        AppleAuth.AppleAuthenticationScope.EMAIL,
        AppleAuth.AppleAuthenticationScope.FULL_NAME,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      throw new Error('Apple sign-in did not return an identity token.');
    }
    const data = await api.socialSignIn('apple', credential.identityToken, rawNonce);
    if (!data?.accessToken) throw new Error('Sign-in failed. Please try again.');
    const auth = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    // Apple only sends fullName on the very first sign-in. Persist locally
    // so the greeting on Today shows their first name from then on.
    const first = credential.fullName?.givenName?.trim();
    if (first) {
      try { await AsyncStorage.setItem(NAME_KEY, first); } catch {}
      set({ userName: first });
    }
    // Apple only returns email on the first sign-in; persist it when present.
    if (credential.email) await persistEmail(credential.email, set);
    await get().postSignInBootstrap();
    return data;
  },

  // Sign in with Google. Same end-state as signInWithApple.
  signInWithGoogle: async () => {
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    // hasPlayServices is a no-op on iOS but harmless; on Android it's required.
    try { await GoogleSignin.hasPlayServices(); } catch {}
    const result = await GoogleSignin.signIn();
    // v16+ returns { type: 'success' | 'cancelled', data?: {...} } and
    // does NOT throw on cancel. Older versions returned the data flat and
    // threw on cancel. Handle both, and surface cancel as a typed error
    // the UI can swallow silently.
    if (result?.type === 'cancelled') {
      const err = new Error('Sign-in cancelled');
      err.code = 'SIGN_IN_CANCELLED';
      throw err;
    }
    const userInfo = result?.data || result;
    const idToken = userInfo?.idToken || userInfo?.user?.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return an idToken.');
    }
    const data = await api.socialSignIn('google', idToken, null);
    if (!data?.accessToken) throw new Error('Sign-in failed. Please try again.');
    const auth = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
    };
    setTokens(auth.accessToken, auth.refreshToken);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    const first = (userInfo?.user?.givenName || userInfo?.user?.name || '').trim().split(/\s+/)[0];
    if (first) {
      try { await AsyncStorage.setItem(NAME_KEY, first); } catch {}
      set({ userName: first });
    }
    if (userInfo?.user?.email) await persistEmail(userInfo.user.email, set);
    await get().postSignInBootstrap();
    return data;
  },

  // Shared sign-in tail. Bootstraps the user against the server with retries,
  // uses the AUTHORITATIVE server uiState (or onboardingCompletedAt) to decide
  // whether onboarding is needed. If the server is genuinely unreachable after
  // retries AND we have a previously-cached profile locally, trust the local
  // cache and let the user into the app rather than dumping them back into
  // onboarding (the prior bug — every transient network error re-onboarded
  // returning users).
  postSignInBootstrap: async () => {
    // Recover the current account id (written to AUTH_KEY by every sign-in
    // path before this runs). Used to scope the durable onboarded marker.
    let userId = get().userId;
    if (!userId) {
      try {
        const authJson = await AsyncStorage.getItem(AUTH_KEY);
        if (authJson) userId = JSON.parse(authJson)?.userId || null;
      } catch {}
    }
    if (userId) set({ userId });

    // Associate RevenueCat with this account so purchases (and the server's
    // entitlement lookup) are tied to the signed-in user — not an anonymous RC
    // id. Without this, a fresh sign-in session couldn't complete a purchase.
    if (userId) {
      try { await require('../purchases').identifyPurchases(userId); } catch {}
      // Re-check entitlement now that RC knows who we are.
      try {
        const active = await require('../purchases').checkSubscription();
        if (active !== get().isSubscribed) {
          set({ isSubscribed: active });
          try { await AsyncStorage.setItem('livenew:subscribed', JSON.stringify(active)); } catch {}
        }
      } catch {}
    }

    // Restore the real HealthKit permission status. The OS grant is
    // device-level and survives logout, but `healthPermission` lives in
    // memory and isn't restored by any login path (only cold-boot hydrate
    // reads it). Without this, a logout→login within the same app session
    // leaves it stale ('unknown'/'denied'), so a returning user who already
    // granted Health gets re-prompted on Account. Mirror hydrate (~line 250).
    // Defensive: never let this throw and block sign-in.
    try {
      const healthPermission = await getHealthPermissionStatus();
      set({ healthPermission });
      if (healthPermission === 'granted') {
        get().refreshHealthSnapshot().catch(() => {});
      }
    } catch {}

    let bootstrap = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        bootstrap = await api.bootstrap();
        break;
      } catch (err) {
        lastErr = err;
        // Linear backoff: 300ms, 600ms.
        if (attempt < 2) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
    }

    if (bootstrap) {
      const p = bootstrap?.profile || {};
      set({ isComped: p.isPro === true });
      set({ appUpdate: parseAppUpdate(bootstrap) });
      const profile = {
        routine: p.routine || null,
        stressSource: p.stressSource || null,
        wakeTime: p.wakeTime || null,
        timeMin: p.timeMin || null,
        injuries: p.injuries || [],
        schedule: p.schedule || null,
      };
      // Source of truth: server's uiState. "home" means fully onboarded.
      // Fall back to profile.isComplete or routine presence for older server
      // versions. Crucially we DON'T require local routine to be non-null —
      // the server is authoritative on this account's onboarding status.
      const serverSaysOnboarded =
        bootstrap?.uiState === 'home' ||
        bootstrap?.profile?.isComplete === true ||
        !!profile.routine;
      try { await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
      // Durable, account-scoped record that this user is onboarded — survives
      // logout so a future flaky-network re-login doesn't re-onboard them.
      if (serverSaysOnboarded) await writeOnboardedMarker(userId);
      // Load the avatar from the authoritative server value (or fall back to the
      // local cache for this account, so a returning user sees their photo).
      if (p.avatar_url) {
        set({ avatarUri: p.avatar_url });
        try { await AsyncStorage.setItem(avatarKey(userId), p.avatar_url); } catch {}
      } else {
        get().loadAvatar();
      }
      set({ isLoggedIn: true, hasProfile: serverSaysOnboarded, profile });
      return;
    }

    // Server unreachable after retries. Check for a locally-cached profile —
    // if we have one, the user was onboarded on this device before; let them
    // in. If we don't, we genuinely don't know, so default to letting them
    // attempt the app (the empty Today screen handles no-plan gracefully and
    // they can complete onboarding via Account if needed).
    console.warn('[auth] postSignInBootstrap: bootstrap failed after retries', lastErr?.message);
    // Durable account-scoped marker is the primary offline signal. Unlike
    // PROFILE_KEY (wiped on logout), this survives sign-out, so a returning
    // user who onboarded on this device is recognized even with no network.
    if (await readOnboardedMarker(userId)) {
      let profile = null;
      try {
        const profileJson = await AsyncStorage.getItem(PROFILE_KEY);
        if (profileJson) profile = JSON.parse(profileJson);
      } catch {}
      set({ isLoggedIn: true, hasProfile: true, profile });
      return;
    }
    try {
      const profileJson = await AsyncStorage.getItem(PROFILE_KEY);
      if (profileJson) {
        const profile = JSON.parse(profileJson);
        const hasProfile = !!(profile && profile.routine);
        set({ isLoggedIn: true, hasProfile, profile });
        return;
      }
    } catch {}
    // No durable marker and no local cache — genuinely a new/unknown account
    // on this device. Log them in but route to onboarding. This is the only
    // case that should ever land here post-fix.
    set({ isLoggedIn: true, hasProfile: false });
  },

  // User chose to skip today's check-in. Persists for the logical day only
  // (so a skip at 11pm doesn't get cleared 1 hour later at midnight while
  // the user is still up).
  skipToday: async () => {
    const today = getLogicalDateISO();
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
      let reason = '';
      try {
        const { getHealthKitLoadError } = require('../healthkit');
        const err = getHealthKitLoadError();
        if (err) reason = ` (${err})`;
      } catch {}
      return { ok: false, error: `HealthKit not available on this device.${reason}` };
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

  // Turn OFF the app's use of Health data. iOS can't revoke the OS HealthKit
  // grant programmatically — that lives in Settings → Health → Apps → LiveNew —
  // so this clears the app side: flips our persisted status to 'denied', drops
  // the cached snapshot, and persists via the same setter connectHealth uses.
  // The score / plan stop reading biometrics until the user reconnects.
  disconnectHealth: async () => {
    set({ healthPermission: 'denied', healthSnapshot: null });
    await setHealthPermissionStatus('denied');
    return { ok: true };
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

  // Save the profile (e.g. editing your routine/schedule from Account).
  // PRESERVES today's plan: editing your routine must NOT delete the plan you
  // already generated today — that wiped it out and forced a surprise
  // re-check-in ("where did my plan go?"). The updated routine shapes FUTURE
  // plans; today's stays put. (Onboarding's first generation uses
  // saveProfileWithoutNav below, before any plan exists.)
  saveProfile: async (profile) => {
    const prepared = prepareProfileForSave(profile);
    await api.onboardComplete(prepared);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(prepared));
    await writeOnboardedMarker(get().userId);
    set({ hasProfile: true, profile: prepared });
  },

  // Save profile WITHOUT triggering navigation — used during onboarding
  // so we can save profile + generate plan before flipping to MainTabs
  saveProfileWithoutNav: async (profile) => {
    // Accept consent first (required before any other server calls work)
    await api.acceptConsent();
    const prepared = prepareProfileForSave(profile);
    await api.onboardComplete(prepared);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(prepared));
    await AsyncStorage.removeItem(PLAN_KEY);
    await writeOnboardedMarker(get().userId);
    // hasProfile intentionally not set here; onboarding calls activateProfile() after the plan generates.
    set({ profile: prepared, todayPlan: null, todayDate: null, completed: {}, reflection: null });
  },

  // Flip hasProfile to trigger navigation to MainTabs
  activateProfile: () => {
    set({ hasProfile: true });
  },

  // Manual light/dark mode override. 'system' falls back to the OS scheme.
  setThemeMode: async (mode) => {
    const valid = mode === 'light' || mode === 'dark' ? mode : 'system';
    set({ themeMode: valid });
    try { await AsyncStorage.setItem('livenew:theme_mode', valid); } catch {}
  },

  // Choose which (earned) aura recolors the app accent + adds a soft bg tint.
  // Pass an aura id to apply; pass null/'' to reset to the default gold theme.
  // Device-local + reversible — useTheme() reads selectedAuraId and overrides
  // the accent live, so every screen re-renders into the new color. We persist
  // '' (not a missing key) for null so the stored value is always explicit.
  setSelectedAura: async (id) => {
    const next = id || null;
    set({ selectedAuraId: next });
    try { await AsyncStorage.setItem(SELECTED_AURA_KEY, next || ''); } catch {}
  },

  // Initialize the 14-day free trial. Idempotent — safe to call on every
  // hydrate / signup. Sets a date if one isn't already stored.
  ensureTrialStart: async () => {
    const existing = get().trialStartISO;
    if (existing) return existing;
    try {
      const stored = await AsyncStorage.getItem('livenew:trial_start');
      if (stored) {
        set({ trialStartISO: stored });
        return stored;
      }
    } catch {}
    const today = getLocalDateISO();
    set({ trialStartISO: today });
    try { await AsyncStorage.setItem('livenew:trial_start', today); } catch {}
    return today;
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
    // Sleep-window gate (defense in depth). UI paths already block plan
    // generation between 10pm-5am, but a typed error here ensures no future
    // path can sneak past — generating a plan during the user's sleep
    // window produces a plan that's mostly in the past and reads as broken.
    // Caller can catch SLEEP_WINDOW and surface a sleep-mode UI instead.
    if (isSleepWindow()) {
      const err = new Error("It's sleep time — Iris is offline until morning.");
      err.code = 'SLEEP_WINDOW';
      throw err;
    }

    // Trial tracking: ensure a trial-start date is set for this user.
    // No paywall gate here — the daily plan is free forever (basics always on).
    // Premium gates live at the feature level (soundscapes, analytics, etc.).
    await get().ensureTrialStart();

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

    // Stable idempotency key for THIS check-in attempt (same inputs → same key)
    // so an auto-retry after a backgrounding socket-drop won't double-count.
    const idemKey = `checkin-${get().userId || 'anon'}-${getLogicalDateISO()}-${stressValue}-${sleepQuality}-${energy}`;
    const data = await api.checkin({
      // Server expects the calendar date (its day-boundary logic handles
      // late-night sessions on its own). Don't send logical-date — that's
      // for client-side persistence only.
      dateISO: getLocalDateISO(),
      // Device timezone so the server derives the plan's time-of-day from the
      // user's ACTUAL local time, not the server clock / LA default. Sent on
      // every check-in so it stays correct even before a profile save and
      // updates automatically if the user travels.
      timezone: getDeviceTimezone(),
      stress: stressValue,
      stressLabel,
      sleepQuality,   // "great" | "okay" | "rough"
      energy,         // "high" | "medium" | "low"
      routine: profile.routine || '',
      healthSnapshot, // null if not connected; server handles either way
    }, idemKey);

    // New schema: validate zones[]. Backward-compat: still accept old plan[]
    // for users mid-migration but treat absence of zones as a failure for new
    // generations.
    const hasZones = data && Array.isArray(data.zones) && data.zones.length > 0;
    const hasLegacyPlan = data && Array.isArray(data.plan) && data.plan.length > 0;
    if (!data || data.ok === false || (!hasZones && !hasLegacyPlan)) {
      throw new Error('Plan generation failed. Please try again.');
    }

    // Use the LOGICAL date for the plan's persistence key so a plan
    // generated at 9pm stays valid through the user's wake-up at 6am.
    // (Without this, a plan generated at 11:55pm would expire 5 minutes
    // later when the calendar day rolled over.)
    const today = getLogicalDateISO();
    const plan = {
      date: today,
      contract: data,     // { zones, goalThread, stressRelief, eveningPrompt }
      stress: stressValue,
      stressLabel,        // persist the label so hydrate restores todayStressLabel after a cold boot (otherwise computeScore takes a degraded branch)
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

    // Schedule notifications.
    //   - scheduleCheckInReminders ignores its opts: the daily check-in
    //     nudges are always-on by design (product decision). Generating a plan
    //     does NOT suppress today's nudges — we still call it to (re)establish
    //     the recurring all-day check-in schedule.
    //   - scheduleSessionReminders schedules today's zone notifications
    //     as one-shots — each fires once at its zone time with that
    //     zone's headline, then gone.
    try {
      const granted = await requestPermissions();
      if (granted) {
        await scheduleCheckInReminders({ hasPlanToday: true });
        if (hasZones) await scheduleSessionReminders(data.zones);
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
      // Current schema is todayPlan.zones (not .plan). markDone's `index` is
      // the position of the acknowledged zone in that array; each zone carries
      // a `type` (intervention type) and an `id` (zone slot). Report the real
      // intervention type so completion tracking isn't always 'unknown'.
      const zones = get().todayPlan?.zones || [];
      const item = zones[index];
      api.feedback({
        type: 'item_completed',
        dateISO: getLocalDateISO(),
        sessionIndex: index,
        interventionType: item?.type || item?.id || 'unknown',
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
      const record = raw ? JSON.parse(raw) : null;

      const today             = getLocalDateISO();
      const yesterday         = getYesterdayISO();
      const dayBeforeYesterday = getDayBeforeYesterdayISO();
      const currentWeekId     = getWeekIdISO();

      // Compute premium status directly (useIsPremium is a hook — can't call here).
      const state = get();
      // Resolve the REAL trial start. loadStreak runs during hydrate BEFORE
      // ensureTrialStart populates state.trialStartISO, so it's still null here.
      // isWithinTrial(null) returns true (full window), which would make every
      // user — including free / expired-trial ones — appear premium and bypass
      // the streak-freeze gate. Read the persisted value directly to be correct.
      let trialStartISO = state.trialStartISO;
      if (!trialStartISO) {
        try { trialStartISO = await AsyncStorage.getItem('livenew:trial_start'); } catch {}
      }
      const isPremiumNow = state.isSubscribed || state.isComped || isWithinTrial(trialStartISO);

      // Read the per-account freeze ledger (survives logout, removed on deleteAccount).
      const userId = state.userId;
      let lastUsedAt = null;
      const fKey = streakFreezeKey(userId);
      if (fKey) {
        try {
          const ledgerRaw = await AsyncStorage.getItem(fKey);
          if (ledgerRaw) { const ledger = JSON.parse(ledgerRaw); lastUsedAt = ledger.lastUsedAt || null; }
        } catch {}
      }

      // Eligibility: premium can save anytime; free gets one save then a 7-day
      // rolling cooldown. We DON'T auto-spend — a scarce free save shouldn't
      // disappear on a day the user didn't care about.
      const cooldownDaysLeft = freezeCooldownDaysLeft(lastUsedAt, today);
      const freezeEligible = isPremiumNow || cooldownDaysLeft === 0;

      const result = classifyStreakOnLoad(record, { today, yesterday, dayBeforeYesterday });

      if (result.status === 'saveable') {
        // Missed exactly one day. Don't break OR save yet — surface the choice.
        // Leave the stored record untouched so apply/decline both work cleanly.
        set({
          streak: result.count,
          streakSavedByFreeze: false,
          streakFreezeReady: freezeEligible,
          streakFreezeOffer: {
            count: result.count,
            saveToDate: result.saveToDate,
            eligible: freezeEligible,
            isPremium: isPremiumNow,
            cooldownDaysLeft,
          },
        });
      } else if (result.status === 'broken') {
        try { await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: 0, lastDate: null })); } catch {}
        set({ streak: 0, streakSavedByFreeze: false, streakFreezeReady: freezeEligible, streakFreezeOffer: null });
      } else {
        // intact
        set({ streak: result.count, streakSavedByFreeze: false, streakFreezeReady: freezeEligible, streakFreezeOffer: null });
      }
    } catch {}
  },

  clearStreakSavedFlag: () => set({ streakSavedByFreeze: false }),

  // User chose to spend a freeze to save the missed-day streak. Advances the
  // stored record to `saveToDate` (yesterday) so today's check-in continues it,
  // and stamps the cooldown ledger. Premium re-stamps too but ignores cooldown.
  applyStreakFreeze: async () => {
    const state = get();
    const offer = state.streakFreezeOffer;
    const isPremiumNow = state.isSubscribed || state.isComped;
    // Re-check eligibility live (covers upgrading to premium from the offer).
    if (!offer || !(offer.eligible || isPremiumNow)) return false;
    const today = getLocalDateISO();
    try {
      await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: offer.count, lastDate: offer.saveToDate }));
    } catch {}
    const fKey = streakFreezeKey(state.userId);
    if (fKey) { try { await AsyncStorage.setItem(fKey, JSON.stringify({ lastUsedAt: today })); } catch {} }
    set({
      streak: offer.count,
      streakSavedByFreeze: true,
      // Premium stays ready; free is now on cooldown.
      streakFreezeReady: isPremiumNow,
      streakFreezeOffer: null,
    });
    return true;
  },

  // User let the streak go. Persist the reset and clear the offer.
  declineStreakFreeze: async () => {
    try { await AsyncStorage.setItem('livenew:streak', JSON.stringify({ count: 0, lastDate: null })); } catch {}
    set({ streak: 0, streakSavedByFreeze: false, streakFreezeOffer: null });
  },

  loadGems: async () => {
    const userId = get().userId;
    try {
      const raw = await AsyncStorage.getItem(gemsKey(userId));
      let maxStreak = 0; let gemEarnedAt = {};
      if (raw) { const d = JSON.parse(raw); maxStreak = d.maxStreak || 0; gemEarnedAt = d.gemEarnedAt || {}; }
      // Seed from current streak for existing users with no gem record yet.
      const cur = get().streak || 0;
      if (cur > maxStreak) {
        maxStreak = cur;
        const today = getLocalDateISO();
        for (const g of earnedGems(maxStreak)) if (!gemEarnedAt[g.id]) gemEarnedAt[g.id] = today;
        try { await AsyncStorage.setItem(gemsKey(userId), JSON.stringify({ maxStreak, gemEarnedAt })); } catch {}
      }
      set({ maxStreak, gemEarnedAt });
    } catch {}
  },

  // Load the account-scoped avatar URL from the local cache for instant
  // display. The authoritative source is the server (profile.avatar_url from
  // bootstrap), but reading the cache here — before the network returns — means
  // a returning user sees their photo immediately, even offline. The bootstrap
  // merge (see hydrate) overwrites this with the fresh server URL when it lands.
  // Fire-and-forget from hydrate (mirrors loadGems). Missing key → null.
  loadAvatar: async () => {
    const userId = get().userId;
    try {
      const uri = await AsyncStorage.getItem(avatarKey(userId));
      if (uri) set({ avatarUri: uri });
    } catch {}
  },

  // Upload a newly-picked profile photo. `asset` = { base64, ext }. We send the
  // base64 to the server, which stores it in Supabase Storage and returns the
  // public URL; we then reflect that URL in state and cache it locally (account-
  // scoped) for instant offline display next launch. Returns { ok, error } so
  // the UI can surface the ACTUAL server failure (e.g. "image too large") instead
  // of a generic message — a too-large image looks different from a bucket error.
  // `avatarUploading` drives the in-UI spinner.
  setAvatar: async (asset) => {
    const base64 = asset?.base64;
    const ext = asset?.ext === 'png' ? 'png' : 'jpg';
    if (!base64) return { ok: false, error: 'No image data.' };
    set({ avatarUploading: true });
    try {
      const r = await api.uploadAvatar(base64, ext);
      if (r?.avatarUrl) {
        const userId = get().userId;
        set({ avatarUri: r.avatarUrl });
        try { await AsyncStorage.setItem(avatarKey(userId), r.avatarUrl); } catch {}
        return { ok: true, error: null };
      }
      // Server returned 200 with no URL — surface any message it included.
      return { ok: false, error: r?.error || r?.message || null };
    } catch (err) {
      // Network / non-2xx error — surface the thrown message so a 413-style
      // "too large" or a misconfigured-bucket error is distinguishable.
      return { ok: false, error: err?.message || null };
    } finally {
      set({ avatarUploading: false });
    }
  },

  // Update the user's display (first) name. Reuses the SAME field+key the app
  // already uses for the first name (userName / NAME_KEY) — Iris's greetings,
  // signup, and social sign-in all read/write this. No new field invented.
  setDisplayName: async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    set({ userName: trimmed });
    try { await AsyncStorage.setItem(NAME_KEY, trimmed); } catch {}
  },

  fetchHaloStats: async () => {
    try {
      const r = await api.haloStats();
      if (r && r.stats && typeof r.stats === 'object') {
        set({ haloStats: r.stats });
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

      // Gems: update permanent max + record any newly-crossed gem.
      const userId = get().userId;
      const prevMax = get().maxStreak || 0;
      if (newCount > prevMax) {
        const today2 = getLocalDateISO();
        const before = new Set(earnedGems(prevMax).map((g) => g.id));
        const nowEarned = earnedGems(newCount);
        const gemEarnedAt = { ...get().gemEarnedAt };
        let justUnlocked = null;
        for (const g of nowEarned) {
          if (!before.has(g.id)) { gemEarnedAt[g.id] = today2; justUnlocked = g.id; }
        }
        set({ maxStreak: newCount, gemEarnedAt, ...(justUnlocked ? { pendingGemUnlock: justUnlocked } : {}) });
        try { await AsyncStorage.setItem(gemsKey(userId), JSON.stringify({ maxStreak: newCount, gemEarnedAt })); } catch {}
      }
    } catch {}
  },

  clearPendingGemUnlock: () => set({ pendingGemUnlock: null }),

  // Logout — clears EVERY per-user AsyncStorage key plus the widget payload.
  // Missing any one of these means the next user inherits state from the
  // previous user.
  logout: async () => {
    try { await api.logout(); } catch {}
    try { await require('../purchases').logoutPurchases(); } catch {}
    clearTokens();
    await AsyncStorage.multiRemove([
      AUTH_KEY, PROFILE_KEY, PLAN_KEY, NAME_KEY, EMAIL_KEY,
      'livenew:subscribed', 'livenew:streak', 'livenew:plan_count',
      'livenew:plan_count_last_day', 'livenew:first_plan_at',
      'livenew:notif_prefs_v1', 'livenew:notif_permission',
      'livenew:goal_nudge_dismissed', 'livenew:share_card_variant',
      'livenew:lastCelebratedStreak', 'livenew:goal_set_at',
      'livenew:progress_cache_v1', 'livenew:health_snapshot_v1',
      'livenew:review_prompted',
      'livenew:streak_risk_dismissed', 'livenew:live_activity_id',
      'livenew:seen_first_plan_welcome', 'livenew:seen_tts_hint',
      // Trial + skip state are device-local and NOT account-scoped — clear them
      // so a second account signing in on this device doesn't inherit the first
      // user's (possibly expired) trial window or stale "skipped today" flag.
      'livenew:trial_start', SKIPPED_KEY,
      // Selected aura is device-local; reset to default gold on logout so the
      // next user doesn't inherit the previous user's accent recolor.
      SELECTED_AURA_KEY,
      // NOTE: 'livenew:health_permission_status' is deliberately NOT removed.
      // The HealthKit grant is DEVICE-LEVEL (owned by iOS, lives in Settings →
      // Health → Apps → LiveNew) and survives logout — iOS keeps honoring it.
      // Wiping our flag made a returning user who re-logs in look un-granted,
      // so they got re-prompted to "Connect Apple Health" despite already
      // having granted it. We clear the cached snapshot below (account data)
      // but keep the device-level permission flag. A different account signing
      // in on the same device inherits only the OS grant, which is correct —
      // the OS grant is per-device, not per-account.
      // NOTE: the account-scoped avatar key (avatarKey(userId)) is NOT removed
      // here — like gems/freeze, the picture belongs to the account and should
      // survive logout. We only reset avatarUri in state below.
    ]);
    try {
      const { clearWidgetPayload } = require('../widgetBridge');
      await clearWidgetPayload();
    } catch {}
    try {
      const { clearAllZoneNotifications } = require('../notifications');
      await clearAllZoneNotifications();
    } catch {}
    try {
      const { endLiveActivity } = require('../liveActivityBridge');
      await endLiveActivity(null, null);
    } catch {}
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      userName: null, userEmail: null, avatarUri: null,
      userId: null, trialStartISO: null, skippedDate: null, selectedAuraId: null,
      todayPlan: null, todayDate: null, todayStress: null, todayStressLabel: null,
      todaySleep: null, todayEnergy: null, isSubscribed: false, isComped: false,
      completed: {}, reflection: null, streak: 0,
      healthPermission: 'unknown', healthSnapshot: null,
      maxStreak: 0, gemEarnedAt: {}, pendingGemUnlock: null,
      // Reset transient freeze flags (the account-scoped ledger key survives logout intentionally)
      streakSavedByFreeze: false, streakFreezeReady: false, streakFreezeOffer: null,
    });
  },

  // Delete account — same cleanup as logout, plus server-side delete.
  deleteAccount: async () => {
    // Capture the account id before teardown so we can purge its durable,
    // account-scoped markers (onboarded + seen-welcome) — the account is gone,
    // so unlike logout these SHOULD be removed.
    const deletedUserId = get().userId;
    await api.deleteAccount();
    clearTokens();
    await AsyncStorage.multiRemove([
      AUTH_KEY, PROFILE_KEY, PLAN_KEY, NAME_KEY, EMAIL_KEY,
      'livenew:subscribed', 'livenew:streak', 'livenew:plan_count',
      'livenew:plan_count_last_day', 'livenew:first_plan_at',
      'livenew:notif_prefs_v1', 'livenew:notif_permission',
      'livenew:goal_nudge_dismissed', 'livenew:share_card_variant',
      'livenew:lastCelebratedStreak', 'livenew:goal_set_at',
      'livenew:progress_cache_v1', 'livenew:health_snapshot_v1',
      'livenew:health_permission_status', 'livenew:review_prompted',
      'livenew:streak_risk_dismissed', 'livenew:live_activity_id',
      'livenew:seen_first_plan_welcome', 'livenew:seen_tts_hint',
      // Device-local trial + skip state (see logout for rationale).
      'livenew:trial_start', SKIPPED_KEY, SELECTED_AURA_KEY,
      ...(deletedUserId ? [
        `livenew:onboarded:${deletedUserId}`,
        `livenew:seen_first_plan_welcome:${deletedUserId}`,
        gemsKey(deletedUserId),
        streakFreezeKey(deletedUserId),
        // The account is gone — unlike logout, the scoped avatar SHOULD be purged.
        avatarKey(deletedUserId),
      ].filter(Boolean) : []),
    ]);
    try {
      const { clearWidgetPayload } = require('../widgetBridge');
      await clearWidgetPayload();
    } catch {}
    try {
      const { clearAllZoneNotifications } = require('../notifications');
      await clearAllZoneNotifications();
    } catch {}
    try {
      const { endLiveActivity } = require('../liveActivityBridge');
      await endLiveActivity(null, null);
    } catch {}
    set({
      isLoggedIn: false, hasProfile: false, profile: null,
      userName: null, userEmail: null, avatarUri: null,
      userId: null, trialStartISO: null, skippedDate: null, selectedAuraId: null,
      todayPlan: null, todayDate: null, todayStress: null, todayStressLabel: null,
      todaySleep: null, todayEnergy: null, isSubscribed: false, isComped: false,
      completed: {}, reflection: null, streak: 0,
      healthPermission: 'unknown', healthSnapshot: null,
      maxStreak: 0, gemEarnedAt: {}, pendingGemUnlock: null,
      streakSavedByFreeze: false, streakFreezeReady: false, streakFreezeOffer: null,
    });
  },
}));

// Wire api.js -> authStore: when the refresh-token flow fails, force a
// full logout so the user lands on AuthScreen instead of a zombie session.
setAuthExpiredHandler(() => {
  try { useAuthStore.getState().logout(); } catch {}
});
