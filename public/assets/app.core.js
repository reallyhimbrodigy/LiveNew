import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  requestAuth,
  verifyAuth,
  getToken,
  setToken,
  clearTokens,
  setRefreshToken,
  getRefreshToken,
  logoutAuth,
  setDeviceName,
  getDeviceName,
} from "./app.api.js";
import { getAppState as getAppStateInternal, setAppState } from "./app.state.js";
import { qs, qsa, el, clear, setText, formatMinutes, formatPct, applyI18n, getDictValue } from "./app.ui.js";
import { STRINGS as EN_STRINGS } from "../i18n/en.js";
console.log("[LN][core] source-loaded");
let __suppressRedirect = false;
/* REQUIRED: build-time export used by controllers + asset verification */
export function getAppState() {
  try {
    if (typeof window !== "undefined" && window.__LN_STATE__) return window.__LN_STATE__;
  } catch {}
  return {};
}
void getAppStateInternal;
export const BUILD_ID = "__BUILD_ID__";

const LOCALE = "en";
const STRINGS = { en: EN_STRINGS }[LOCALE] || EN_STRINGS;

const t = (key, fallback = "") => getDictValue(STRINGS, key, fallback);
const SIGNALS = [
  { id: "stressed", label: "I'm stressed" },
  { id: "exhausted", label: "I'm exhausted" },
  { id: "ten_minutes", label: "I have 10 minutes" },
  { id: "more_energy", label: "I have more energy" },
];

let citationsById = new Map();
let citationsLoaded = false;
async function ensureCitations() {
  if (citationsLoaded) return citationsById;
  try {
    const res = await apiGet("/v1/citations");
    const list = Array.isArray(res?.citations) ? res.citations : [];
    citationsById = new Map(list.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  } catch {
    citationsById = new Map();
  }
  citationsLoaded = true;
  return citationsById;
}

let appErrorHandler = null;
export function setAppErrorHandler(handler) {
  appErrorHandler = typeof handler === "function" ? handler : null;
}

function reportError(err) {
  if (appErrorHandler) {
    try {
      appErrorHandler(err);
      return;
    } catch (error) {
      console.error(error);
    }
  }
  console.error(err);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function showStep(name) {
  document.querySelectorAll("[data-step]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.step !== name);
  });
}

function showOnboardStep(name) {
  document.querySelectorAll(".onboard-step").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.onboard !== name);
  });
}

function saveTodayPlan(dateISO, contract, stress, wakeTimeValue) {
  try {
    const m = contract?.movement || contract?.move || contract?.workout || null;
    const r = contract?.reset || null;
    const n = contract?.nutrition || null;
    const w = contract?.winddown || null;
    const slim = {
      dateISO: contract?.dateISO || dateISO,
      movement: m ? { id: m.id, title: m.title, description: m.description, phases: m.phases, minutes: m.minutes || m.durationMin } : null,
      reset: r ? { id: r.id, title: r.title, description: r.description, phases: r.phases } : null,
      nutrition: n ? { id: n.id, title: n.title, morning: n.morning || n.tip || null, evening: n.evening || null } : null,
      winddown: w ? { id: w.id, title: w.title, description: w.description, phases: w.phases } : null,
    };
    localStorage.setItem(
      "livenew_today",
      JSON.stringify({
        date: dateISO,
        contract: slim,
        stress,
        wakeTime: wakeTimeValue,
        resetCompleted: false,
        moveCompleted: false,
        winddownCompleted: false,
      })
    );
    console.log("[SAVE_TODAY] saved, date:", dateISO);
  } catch (err) {
    console.error("[SAVE_TODAY] failed:", err);
  }
}

function loadTodayPlan() {
  try {
    const raw = localStorage.getItem("livenew_today");
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (saved.date !== today) {
      localStorage.removeItem("livenew_today");
      return null;
    }
    return saved;
  } catch (err) {
    console.error("[LOAD_TODAY] failed:", err);
    try { localStorage.removeItem("livenew_today"); } catch {}
    return null;
  }
}

function computeSchedule(wakeTimeValue) {
  const wakeHourMap = { early: 6, normal: 8, late: 10 };
  const wakeHour = wakeHourMap[wakeTimeValue] || 8;
  return {
    morning: { label: "Morning", startHour: wakeHour, endHour: wakeHour + 3 },
    midday: { label: "Midday", startHour: wakeHour + 4, endHour: wakeHour + 7 },
    evening: { label: "Evening", startHour: wakeHour + 12, endHour: wakeHour + 15 },
  };
}

function formatHour(h) {
  const hour = h % 24;
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function getCurrentWindow(schedule) {
  const now = new Date().getHours();
  if (now < schedule.midday.startHour) return "morning";
  if (now < schedule.evening.startHour) return "midday";
  return "evening";
}

const LiveNewAudio = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  function playTone(freq, duration, type = "sine", volume = 0.15) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);

      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(volume, c.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

      osc.connect(gain);
      gain.connect(c.destination);

      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration);
    } catch {}
  }

  return {
    sessionStart() {
      playTone(523.25, 0.8, "sine", 0.12);
      setTimeout(() => playTone(659.25, 0.8, "sine", 0.10), 200);
    },
    phaseTransition() {
      playTone(783.99, 0.5, "sine", 0.08);
    },
    sessionComplete() {
      playTone(523.25, 0.6, "sine", 0.12);
      setTimeout(() => playTone(659.25, 0.6, "sine", 0.10), 150);
      setTimeout(() => playTone(783.99, 0.8, "sine", 0.10), 300);
      setTimeout(() => playTone(1046.50, 1.0, "sine", 0.08), 500);
    },
  };
})();

let currentActiveSessionType = null;

function triggerActiveSession() {
  if (currentActiveSessionType === "move") qs("#start-move")?.click();
  else if (currentActiveSessionType === "reset") qs("#start-reset")?.click();
  else if (currentActiveSessionType === "winddown") qs("#start-winddown")?.click();
}

function showFirstSessionFrame(onContinue) {
  const overlay = document.createElement("div");
  overlay.className = "first-session-overlay";
  overlay.innerHTML = `
    <div class="first-session-content">
      <h2>This isn't meditation</h2>
      <p>You're about to physically reset your stress in a few minutes. Follow each instruction as it appears. That's it.</p>
      <button class="primary" id="first-session-go" type="button" style="margin-top:20px">Let's go</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#first-session-go")?.addEventListener("click", () => {
    overlay.remove();
    localStorage.setItem("livenew_first_done", "1");
    onContinue();
  });
}

async function registerServiceWorker() {
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("[SW] Registered:", reg.scope);
  } catch (err) {
    console.error("[SW] Registration failed:", err);
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  if (Notification.permission === "granted") {
    await registerServiceWorker();
    return;
  }
  if (Notification.permission === "denied") return;

  const result = await Notification.requestPermission();
  if (result === "granted") {
    console.log("[NOTIFICATIONS] Permission granted");
    await registerServiceWorker();
  }
}

function scheduleNotifications(wakeTimeValue) {
  if (!("serviceWorker" in navigator)) return;
  const schedule = computeSchedule(wakeTimeValue || "normal");
  navigator.serviceWorker.ready.then((reg) => {
    reg.active?.postMessage({
      type: "schedule-notifications",
      schedule: {
        midday: schedule.midday.startHour,
        evening: schedule.evening.startHour,
      },
    });
  });
}

function getTrialStatus() {
  try {
    const data = JSON.parse(localStorage.getItem("livenew_trial") || "{}");
    return data;
  } catch {
    return {};
  }
}

function setTrialStarted() {
  try {
    const existing = getTrialStatus();
    if (!existing.startDate) {
      localStorage.setItem(
        "livenew_trial",
        JSON.stringify({
          startDate: new Date().toISOString().slice(0, 10),
          isSubscribed: false,
        })
      );
    }
  } catch {}
}

function isTrialExpired() {
  const trial = getTrialStatus();
  if (trial.isSubscribed) return false;
  if (!trial.startDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return today > trial.startDate;
}

function markSubscribed() {
  try {
    const trial = getTrialStatus();
    trial.isSubscribed = true;
    localStorage.setItem("livenew_trial", JSON.stringify(trial));
  } catch {}
}

async function loadSocialProof() {
  try {
    const res = await apiGet("/v1/stats");
    const count = Number(res?.todayCount || 0);
    const el = qs("#social-proof");
    const countEl = qs("#social-count");
    if (el && countEl && count > 0) {
      countEl.textContent = `${count} sessions completed today`;
      el.classList.remove("hidden");
    } else if (el) {
      el.classList.add("hidden");
    }
  } catch {}
}

async function loadUserProfile() {
  try {
    const cached = localStorage.getItem("livenew_profile");
    if (cached) {
      const profile = JSON.parse(cached);
      if (profile.goal) return profile;
    }
  } catch {}

  try {
    const res = await apiGet("/v1/bootstrap");
    const p = res?.profile || {};
    const profile = {
      goal: p.goal || p.primaryGoal || "feel calmer",
      stressBaseline: p.stressBaseline || "sometimes",
      wakeTime: p.wakeTime || "normal",
      timeMin: p.timeMin || p.timeAvailableMin || 10,
      injuries: p.injuries || [],
    };
    try { localStorage.setItem("livenew_profile", JSON.stringify(profile)); } catch {}
    return profile;
  } catch {
    return { goal: "feel calmer", stressBaseline: "sometimes", wakeTime: "normal", timeMin: 10, injuries: [] };
  }
}

function populateTodayScreen(res, stress, wake) {
  const schedule = computeSchedule(wake || "normal");
  const saved = loadTodayPlan();

  const move = res?.movement || res?.move || res?.workout;
  const reset = res?.reset;
  const winddown = res?.winddown;
  const hasReset = stress > 3 && reset;

  const sessions = [
    move
      ? { key: "morning", type: "move", session: move, title: move.title || "Movement", desc: move.description || "", done: saved?.moveCompleted || false }
      : null,
    hasReset
      ? { key: "midday", type: "reset", session: reset, title: reset.title || "Reset", desc: reset.description || "", done: saved?.resetCompleted || false }
      : null,
    winddown
      ? { key: "evening", type: "winddown", session: winddown, title: winddown.title || "Wind-down", desc: winddown.description || "", done: saved?.winddownCompleted || false }
      : null,
  ].filter(Boolean);

  const allDone = sessions.length > 0 && sessions.every((s) => s.done);
  const nextSession = sessions.find((s) => !s.done);
  currentActiveSessionType = nextSession?.type || null;

  if (allDone) {
    const trial = getTrialStatus();
    if (trial?.startDate && !trial?.isSubscribed) {
      showStep("paywall");
      return;
    }
  }

  const greetingText = qs("#greeting-text");
  const greetingSub = qs("#greeting-sub");
  if (greetingText) {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    greetingText.textContent = timeOfDay;
  }
  if (greetingSub) {
    if (allDone) greetingSub.textContent = "Everything completed — see you tomorrow";
    else if (stress >= 8) greetingSub.textContent = "Stress is high — your plan is focused on calming down";
    else if (stress >= 5) greetingSub.textContent = "Moderate stress — staying steady today";
    else greetingSub.textContent = "You're in a good place — maintaining the balance";
  }

  const activeCard = qs("#today-active-card");
  const nextUp = qs("#today-next-up");
  const allDoneEl = qs("#today-all-done");

  if (allDone) {
    if (activeCard) activeCard.classList.add("hidden");
    if (nextUp) nextUp.classList.add("hidden");
    if (allDoneEl) {
      const contextMap = { morning: "Morning movement", midday: "Midday reset", evening: "Evening wind-down" };
      const checkmarks = sessions.map((s) => `<div class="done-check">✓ ${contextMap[s.key] || s.title}</div>`).join("");
      allDoneEl.innerHTML = `
        <h2 class="done-heading">You're done for today</h2>
        <div class="done-checklist">${checkmarks}</div>
        <p class="done-sub">Everything completed. See you tomorrow.</p>
        <a href="/progress" class="btn primary" style="margin-top:16px;display:inline-block">View your progress</a>
      `;
      allDoneEl.classList.remove("hidden");
    }
  } else if (nextSession) {
    if (allDoneEl) allDoneEl.classList.add("hidden");
    if (activeCard) activeCard.classList.remove("hidden");

    const timeLabel = qs("#active-time-label");
    const titleEl = qs("#active-title");
    const descEl = qs("#active-desc");
    const startBtn = qs("#active-start-btn");

    const contextMap = { morning: "Get moving", midday: "Bring it down", evening: "Wind down" };
    const session = nextSession.session || {};
    const totalMin = Array.isArray(session.phases)
      ? Math.round(session.phases.reduce((sum, p) => sum + (p.minutes || 0), 0))
      : session.minutes || session.durationMin || null;
    const durationText = totalMin ? ` · ${totalMin} min` : "";
    if (timeLabel) timeLabel.textContent = `${contextMap[nextSession.key] || ""}${durationText}`;
    if (titleEl) titleEl.textContent = nextSession.title;
    if (descEl) descEl.textContent = nextSession.desc;
    if (startBtn) {
      startBtn.onclick = () => {
        const hasEverCompleted = localStorage.getItem("livenew_first_done");
        if (!hasEverCompleted) {
          showFirstSessionFrame(() => {
            triggerActiveSession();
          });
        } else {
          triggerActiveSession();
        }
      };
    }

    const afterNext = sessions.find((s) => !s.done && s !== nextSession);
    if (afterNext && nextUp) {
      nextUp.classList.remove("hidden");
      const nextText = qs("#next-up-text");
      if (nextText) nextText.textContent = `Up next: ${afterNext.title} · ${formatHour(schedule[afterNext.key].startHour)}`;
    } else if (nextUp) {
      nextUp.classList.add("hidden");
    }
  } else {
    currentActiveSessionType = null;
    if (activeCard) activeCard.classList.add("hidden");
    if (nextUp) nextUp.classList.add("hidden");
    if (allDoneEl) {
      allDoneEl.classList.remove("hidden");
      const doneTitle = allDoneEl.querySelector("h2");
      const doneBody = allDoneEl.querySelector("p");
      if (doneTitle) doneTitle.textContent = "No sessions today";
      if (doneBody) doneBody.textContent = "Check back tomorrow.";
    }
  }

  const completedList = qs("#today-completed-list");
  if (completedList) {
    const doneSessions = sessions.filter((s) => s.done);
    if (doneSessions.length > 0 && !allDone) {
      const contextMap = { morning: "Morning movement", midday: "Midday reset", evening: "Evening wind-down" };
      completedList.innerHTML = doneSessions
        .map((s) => `<div class="completed-item">✓ ${contextMap[s.key] || s.title}</div>`)
        .join("");
      completedList.classList.remove("hidden");
    } else {
      completedList.innerHTML = "";
      completedList.classList.add("hidden");
    }
  }

  const windowMap = {};
  sessions.forEach((s) => {
    windowMap[s.key] = s;
  });

  ["morning", "midday", "evening"].forEach((key) => {
    const slot = windowMap[key];
    const timeEl = qs(`#${key}-time`);
    const titleEl = qs(`#${key}-title`);
    const statusEl = qs(`#${key}-status`);
    const slotEl = qs(`#timeline-${key}`);

    if (timeEl) timeEl.textContent = formatHour(schedule[key].startHour);

    if (!slot) {
      if (slotEl) slotEl.classList.add("hidden");
      return;
    }
    if (slotEl) slotEl.classList.remove("hidden");
    if (titleEl) titleEl.textContent = slot.title;

    const nowHour = new Date().getHours();
    if (statusEl) {
      if (slot.done) statusEl.textContent = "Done ✓";
      else if (nowHour >= schedule[key].startHour) statusEl.textContent = "Ready";
      else statusEl.textContent = formatHour(schedule[key].startHour);
    }
  });

  const morningTip = qs("#nutrition-morning-tip");
  const eveningTip = qs("#nutrition-evening-tip");
  if (morningTip) morningTip.textContent = res?.nutrition?.morning || "";
  if (eveningTip) eveningTip.textContent = res?.nutrition?.evening || "";

  const recheckinBtn = qs("#recheckin-btn");
  if (recheckinBtn) {
    recheckinBtn.textContent = allDone ? "Check back tomorrow" : "Feeling different? Re-check";
    if (allDone) recheckinBtn.disabled = true;
    else recheckinBtn.disabled = false;
  }

  void loadSocialProof();
}

function getErrorCode(err) {
  return err?.code || err?.payload?.error?.code || null;
}

function getErrorDetails(err) {
  return err?.details || err?.payload?.details || null;
}

function ensureErrorScreen() {
  let screen = qs("#app-error-screen");
  if (screen) return screen;
  const host = qs("main.container") || document.body;
  screen = document.createElement("section");
  screen.id = "app-error-screen";
  screen.className = "card";
  const title = document.createElement("h2");
  title.id = "app-error-title";
  const message = document.createElement("p");
  message.id = "app-error-message";
  const requestId = document.createElement("div");
  requestId.id = "app-error-request";
  requestId.className = "muted";
  screen.appendChild(title);
  screen.appendChild(message);
  screen.appendChild(requestId);
  host.prepend(screen);
  return screen;
}

export function showErrorScreen({ title, message, requestId }) {
  const screen = ensureErrorScreen();
  const titleEl = qs("#app-error-title");
  const messageEl = qs("#app-error-message");
  const requestEl = qs("#app-error-request");
  if (titleEl) titleEl.textContent = title || t("error.genericTitle");
  if (messageEl) messageEl.textContent = message || t("error.genericBody");
  if (requestEl) {
    requestEl.textContent = requestId ? `${t("error.requestId")} ${requestId}` : "";
  }
  screen.classList.remove("hidden");
}

export function showLoginScreen() {
  showErrorScreen({ title: t("error.authTitle"), message: t("error.authBody") });
  qs("#auth-email")?.focus();
}

export function showIncidentScreen(requestId) {
  showErrorScreen({ title: t("error.incidentTitle"), message: t("error.incidentBody"), requestId });
}

function hideGateCard(card) {
  if (card) card.classList.add("hidden");
}

export function hideGateScreens() {
  hideGateCard(qs("#consent-card"));
  hideGateCard(qs("#onboard-card"));
  const screen = qs("#app-error-screen");
  if (screen) screen.classList.add("hidden");
  toggleDaySections(false);
}

function toggleDaySections(hidden) {
  const sections = [
    qs("#rail-card"),
    qs("#day-card"),
    qs("#prefs-card"),
    qs("#community-card"),
    qs("#signals-card"),
    qs("#checkin-card"),
    qs("#completion-card"),
    qs("#feedback-card"),
  ].filter(Boolean);
  sections.forEach((section) => section.classList.toggle("hidden", hidden));
}

let consentHandlers = { onAccepted: null, onError: null, requiredKeys: null };
let consentBound = false;
export function renderConsentScreen({ requiredKeys = null, requiredVersion = null, onAccepted, onError } = {}) {
  const card = qs("#consent-card");
  if (!card) {
    showErrorScreen({
      title: t("error.consentTitle"),
      message: t("error.consentBody"),
    });
    return;
  }
  consentHandlers = { onAccepted, onError, requiredKeys, requiredVersion };
  card.classList.remove("hidden");
  toggleDaySections(true);
  const terms = qs("#consent-terms");
  const privacy = qs("#consent-privacy");
  const alpha = qs("#consent-alpha");
  const submit = qs("#consent-submit");
  const acceptBtn = qs("#consent-accept");
  const status = qs("#consent-status");
  if (status) status.textContent = "";
  if (!consentBound) {
    let pending = false;
    const handleConsentAccept = async () => {
      if (pending) return;
      const required = Array.isArray(consentHandlers.requiredKeys) && consentHandlers.requiredKeys.length
        ? consentHandlers.requiredKeys
        : ["terms", "privacy", "alpha_processing"];
      const accepted = acceptBtn
        ? { terms: true, privacy: true, alpha_processing: true }
        : {
            terms: Boolean(terms?.checked),
            privacy: Boolean(privacy?.checked),
            alpha_processing: Boolean(alpha?.checked),
          };
      const missing = required.filter((key) => accepted[key] !== true);
      if (missing.length) {
        if (status) status.textContent = t("consent.missing");
        return;
      }
      pending = true;
      if (status) status.textContent = t("consent.saving");
      try {
        await apiPost("/v1/consent/accept", {
          accept: { terms: true, privacy: true, alphaProcessing: true },
        });
        hideGateCard(card);
        if (status) status.textContent = "";
        if (typeof consentHandlers.onAccepted === "function") {
          await consentHandlers.onAccepted();
        }
      } catch (err) {
        if (status) status.textContent = t("consent.failed");
        if (typeof consentHandlers.onError === "function") {
          consentHandlers.onError(err);
        } else {
          reportError(err);
        }
      } finally {
        pending = false;
      }
    };
    submit?.addEventListener("click", handleConsentAccept);
    acceptBtn?.addEventListener("click", handleConsentAccept);
    consentBound = true;
  }
  void requiredVersion;
}

let onboardHandlers = { onComplete: null, onError: null };
let onboardBound = false;
let onboardStep = 0;

function isNumberInRange(value, min, max) {
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max;
}

function onboardStepValid(step) {
  if (step === 0) {
    return Boolean(qs("#onboard-timezone")?.value?.trim());
  }
  if (step === 2) {
    return (
      isNumberInRange(qs("#onboard-stress")?.value, 1, 10) &&
      isNumberInRange(qs("#onboard-sleep")?.value, 1, 10) &&
      isNumberInRange(qs("#onboard-energy")?.value, 1, 10)
    );
  }
  if (step === 3) {
    return Boolean(qs("#onboard-consent-terms")?.checked) &&
      Boolean(qs("#onboard-consent-privacy")?.checked) &&
      Boolean(qs("#onboard-consent-alpha")?.checked);
  }
  return true;
}

function updateOnboardReview() {
  const review = qs("#onboard-review");
  if (!review) return;
  const timezone = qs("#onboard-timezone")?.value?.trim() || "–";
  const boundary = qs("#onboard-boundary")?.value ?? "0";
  const stress = qs("#onboard-stress")?.value || "–";
  const sleep = qs("#onboard-sleep")?.value || "–";
  const energy = qs("#onboard-energy")?.value || "–";
  const timeAvailable = qs("#onboard-time")?.value || "–";
  review.textContent =
    `Timezone: ${timezone}\n` +
    `Day boundary: ${boundary}:00\n` +
    `Stress: ${stress} · Sleep: ${sleep} · Energy: ${energy}\n` +
    `Time available: ${timeAvailable} min`;
}

function updateOnboardWizard() {
  const steps = qsa("#onboard-card .onboard-step");
  if (!steps.length) return;
  const stepLabel = qs("#onboard-step-label");
  const backBtn = qs("#onboard-back");
  const nextBtn = qs("#onboard-next");
  const submitBtn = qs("#onboard-submit");
  const total = steps.length;
  const clamped = Math.min(Math.max(onboardStep, 0), total - 1);
  onboardStep = clamped;
  steps.forEach((step, idx) => step.classList.toggle("hidden", idx !== clamped));
  if (stepLabel) stepLabel.textContent = `Step ${clamped + 1} of ${total}`;
  const valid = onboardStepValid(clamped);
  if (backBtn) backBtn.disabled = clamped === 0;
  if (nextBtn) {
    nextBtn.classList.toggle("hidden", clamped === total - 1);
    nextBtn.disabled = !valid;
  }
  if (submitBtn) {
    submitBtn.classList.toggle("hidden", clamped !== total - 1);
    submitBtn.disabled = !valid;
  }
  if (clamped === total - 1) updateOnboardReview();
}

function setOnboardStep(next) {
  onboardStep = next;
  updateOnboardWizard();
}
export function renderOnboardScreen({ onComplete, onError, defaults = {} } = {}) {
  const card = qs("#onboard-card");
  if (!card) {
    showErrorScreen({
      title: t("error.genericTitle"),
      message: t("error.genericBody"),
    });
    return;
  }
  onboardHandlers = { onComplete, onError };
  card.classList.remove("hidden");
  toggleDaySections(true);
  let currentStep = 0;
  let onboardGoal = null;
  let onboardEnergy = null;
  let onboardWakeTime = null;
  let onboardTimeMin = null;
  const status = qs("#onboard-status");
  if (status) status.textContent = "";

  const stressEl = qs("#onboard-stress");
  const sleepEl = qs("#onboard-sleep");
  if (stressEl) stressEl.value = defaults.stress || "5";
  if (sleepEl) sleepEl.value = defaults.sleepQuality || "7";
  const stressDisplay = qs("#onboard-stress-display");
  const sleepDisplay = qs("#onboard-sleep-display");
  if (stressDisplay) stressDisplay.textContent = stressEl?.value || "5";
  if (sleepDisplay) sleepDisplay.textContent = sleepEl?.value || "7";

  function updateOnboardNextEnabled(step) {
    const nextBtn = qs("#onboard-next");
    const submitBtn = qs("#onboard-submit");
    if (step === 1) {
      if (nextBtn) nextBtn.disabled = !onboardGoal;
    } else if (step === 2) {
      if (nextBtn) nextBtn.disabled = !onboardEnergy || !onboardWakeTime || !onboardTimeMin;
    } else if (step === 4) {
      const allChecked = qs("#onboard-consent-terms")?.checked
        && qs("#onboard-consent-privacy")?.checked
        && qs("#onboard-consent-alpha")?.checked;
      if (submitBtn) submitBtn.disabled = !allChecked;
    } else {
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  function showOnboardStep(step) {
    currentStep = step;
    document.querySelectorAll("[data-onboard-step]").forEach((el) => {
      el.classList.toggle("hidden", Number(el.dataset.onboardStep) !== step);
    });
    const backBtn = qs("#onboard-back");
    const nextBtn = qs("#onboard-next");
    const submitBtn = qs("#onboard-submit");

    if (backBtn) backBtn.style.visibility = step === 0 ? "hidden" : "visible";
    if (step === 4) {
      if (nextBtn) nextBtn.classList.add("hidden");
      if (submitBtn) submitBtn.classList.remove("hidden");
    } else {
      if (nextBtn) nextBtn.classList.remove("hidden");
      if (submitBtn) submitBtn.classList.add("hidden");
    }
    if (nextBtn) {
      if (step === 0) nextBtn.textContent = "Get Started";
      else nextBtn.textContent = "Continue";
    }
    updateOnboardNextEnabled(step);
  }

  showOnboardStep(0);

  if (!onboardBound) {
    const backBtn = qs("#onboard-back");
    const nextBtn = qs("#onboard-next");
    const submit = qs("#onboard-submit");

    backBtn?.addEventListener("click", () => {
      if (currentStep > 0) showOnboardStep(currentStep - 1);
    });

    nextBtn?.addEventListener("click", () => {
      if (currentStep < 4) showOnboardStep(currentStep + 1);
    });

    document.querySelectorAll(".onboard-next").forEach((btn) => {
      if (btn.id === "onboard-next") return;
      btn.addEventListener("click", () => {
        if (currentStep < 4) showOnboardStep(currentStep + 1);
      });
    });

    document.querySelectorAll(".goal-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        onboardGoal = btn.dataset.value;
        document.querySelectorAll(".goal-opt").forEach((b) => b.classList.toggle("active", b === btn));
        updateOnboardNextEnabled(1);
      });
    });

    document.querySelectorAll(".onboard-energy-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        onboardEnergy = btn.dataset.value;
        document.querySelectorAll(".onboard-energy-opt").forEach((b) => b.classList.toggle("active", b === btn));
        updateOnboardNextEnabled(2);
      });
    });

    document.querySelectorAll(".onboard-time-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        onboardTimeMin = Number(btn.dataset.value);
        document.querySelectorAll(".onboard-time-opt").forEach((b) => b.classList.toggle("active", b === btn));
        updateOnboardNextEnabled(2);
      });
    });

    document.querySelectorAll(".onboard-wake-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        onboardWakeTime = String(btn.dataset.value || "").trim() || null;
        document.querySelectorAll(".onboard-wake-opt").forEach((b) => b.classList.toggle("active", b === btn));
        updateOnboardNextEnabled(2);
      });
    });

    qs("#onboard-stress")?.addEventListener("input", (e) => {
      const display = qs("#onboard-stress-display");
      if (display) display.textContent = e.target.value;
    });

    qs("#onboard-sleep")?.addEventListener("input", (e) => {
      const display = qs("#onboard-sleep-display");
      if (display) display.textContent = e.target.value;
    });

    qs("#onboard-injury-none")?.addEventListener("change", (e) => {
      if (e.target.checked) {
        ["#onboard-injury-knee", "#onboard-injury-shoulder", "#onboard-injury-back"].forEach((sel) => {
          const el = qs(sel);
          if (el) el.checked = false;
        });
      }
    });

    ["#onboard-injury-knee", "#onboard-injury-shoulder", "#onboard-injury-back"].forEach((sel) => {
      qs(sel)?.addEventListener("change", () => {
        const none = qs("#onboard-injury-none");
        if (none) none.checked = false;
      });
    });

    ["#onboard-consent-terms", "#onboard-consent-privacy", "#onboard-consent-alpha"].forEach((sel) => {
      qs(sel)?.addEventListener("change", () => updateOnboardNextEnabled(4));
    });

    submit?.addEventListener("click", async () => {
      if (status) status.textContent = "Building your first plan...";
      const consent = {
        terms: Boolean(qs("#onboard-consent-terms")?.checked),
        privacy: Boolean(qs("#onboard-consent-privacy")?.checked),
        alphaProcessing: Boolean(qs("#onboard-consent-alpha")?.checked),
      };
      if (!consent.terms || !consent.privacy || !consent.alphaProcessing) {
        if (status) status.textContent = "Something went wrong. Please try again.";
        return;
      }

      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
      const baseline = {
        timezone: detectedTimezone,
        dayBoundaryHour: 0,
        constraints: {
          injuries: {
            knee: Boolean(qs("#onboard-injury-knee")?.checked),
            shoulder: Boolean(qs("#onboard-injury-shoulder")?.checked),
            back: Boolean(qs("#onboard-injury-back")?.checked),
          },
          goal: onboardGoal,
        },
      };
      const sleepHours = Number(qs("#onboard-sleep")?.value || 7);
      const firstCheckIn = {
        stress: Number(qs("#onboard-stress")?.value || 5),
        sleepHours,
        sleepQuality: Math.max(1, Math.min(10, Math.round((sleepHours / 12) * 10))),
        energy: onboardEnergy || "med",
        timeAvailableMin: onboardTimeMin || 10,
        wakeTime: onboardWakeTime || "normal",
      };
      try {
        const res = await apiPost("/v1/onboard/complete", { consent, baseline, firstCheckIn });
        try {
          localStorage.setItem(
            "livenew_profile",
            JSON.stringify({
              goal: onboardGoal || "feel calmer",
              wakeTime: firstCheckIn.wakeTime || "normal",
              energy: onboardEnergy || "med",
              sleepHours: firstCheckIn.sleepHours || 7,
              timeMin: firstCheckIn.timeAvailableMin || 10,
            })
          );
          localStorage.setItem(
            "livenew_onboard_first_checkin",
            JSON.stringify({
              stress: firstCheckIn.stress,
              energy: onboardEnergy || "med",
              sleepHours: firstCheckIn.sleepHours,
              wakeTime: firstCheckIn.wakeTime,
              timeMin: firstCheckIn.timeAvailableMin,
            })
          );
        } catch {}
        if (status) status.textContent = "";
        if (card) card.classList.add("hidden");
        if (typeof onboardHandlers.onComplete === "function") {
          await onboardHandlers.onComplete(res);
        }
      } catch (err) {
        if (status) status.textContent = "Something went wrong. Please try again.";
        if (typeof onboardHandlers.onError === "function") {
          onboardHandlers.onError(err);
        } else {
          reportError(err);
        }
      }
    });
    onboardBound = true;
  }
}

function initBaseUi() {
  applyI18n(STRINGS);
  const page = document.body.dataset.page;
  const titleMap = {
    day: `${t("appName")} — ${t("nav.day")}`,
    week: `${t("appName")} — ${t("nav.week")}`,
    trends: `${t("appName")} — ${t("nav.trends")}`,
    profile: `${t("appName")} — ${t("nav.profile")}`,
  };
  if (page && titleMap[page]) {
    document.title = titleMap[page];
  }
  const accountBtn = qs("#account-menu-btn");
  const accountMenu = qs("#account-menu");
  const accountLogoutBtn = qs("#account-logout-btn");
  if (accountBtn && accountMenu) {
    const closeMenu = () => {
      accountMenu.classList.add("hidden");
      accountBtn.setAttribute("aria-expanded", "false");
    };
    accountBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextHidden = !accountMenu.classList.contains("hidden");
      accountMenu.classList.toggle("hidden", nextHidden);
      accountBtn.setAttribute("aria-expanded", nextHidden ? "false" : "true");
    });
    document.addEventListener("click", (event) => {
      if (!accountMenu.classList.contains("hidden") && !accountMenu.contains(event.target) && event.target !== accountBtn) {
        closeMenu();
      }
    });
    accountLogoutBtn?.addEventListener("click", async () => {
      try {
        if (getRefreshToken()) await logoutAuth();
      } catch {
        // ignore
      }
      clearTokens();
      closeMenu();
      window.location.assign("/login.html");
    });
  }
}

let authHandlers = { onAuthChange: null, onError: null };
let authBound = false;
function bindAuth({ onAuthChange, onError } = {}) {
  authHandlers = { onAuthChange, onError };
  const emailInput = qs("#auth-email");
  const codeInput = qs("#auth-code");
  const requestBtn = qs("#auth-request");
  const verifyBtn = qs("#auth-verify");
  const logoutBtn = qs("#auth-logout");

  updateAuthStatus();

  if (!authBound) {
    requestBtn?.addEventListener("click", async () => {
      const email = emailInput?.value?.trim();
      if (!email) return;
      try {
        await requestAuth(email);
        setText(qs("#auth-status"), t("auth.codeSent"));
      } catch (err) {
        if (typeof authHandlers.onError === "function") authHandlers.onError(err);
        else reportError(err);
      }
    });

    verifyBtn?.addEventListener("click", async () => {
      const email = emailInput?.value?.trim();
      const code = codeInput?.value?.trim();
      if (!email || !code) return;
      try {
        const res = await verifyAuth(email, code);
        if (res?.accessToken || res?.token) {
          setToken(res.accessToken || res.token);
          if (res.refreshToken) setRefreshToken(res.refreshToken);
          updateAuthStatus();
          if (typeof authHandlers.onAuthChange === "function") {
            await authHandlers.onAuthChange({ reason: "login" });
          }
        }
      } catch (err) {
        if (typeof authHandlers.onError === "function") authHandlers.onError(err);
        else reportError(err);
      }
    });

    logoutBtn?.addEventListener("click", async () => {
      try {
        if (getRefreshToken()) await logoutAuth();
      } catch {
        // ignore
      }
      clearTokens();
      updateAuthStatus();
      if (typeof authHandlers.onAuthChange === "function") {
        await authHandlers.onAuthChange({ reason: "logout" });
      }
    });
    authBound = true;
  }
}

function updateAuthStatus() {
  const status = qs("#auth-status");
  if (!status) return;
  status.textContent = getToken() || getRefreshToken() ? t("auth.signedIn") : t("auth.notSignedIn");
}

async function updateAdminVisibility() {
  return;
}

let controllersModule = null;
async function loadControllers() {
  if (!controllersModule) {
    controllersModule = import("./controllers.js");
  }
  return controllersModule;
}

let unhandledHookAttached = false;
let initInFlight = false;
let pendingInit = false;

function resolvePage() {
  const declared = document.body?.dataset?.page;
  if (declared) return declared;
  const path = window.location?.pathname || "/";
  if (path === "/" || path === "/index.html") return "home";
  if (path === "/day" || path === "/day.html") return "day";
  if (path === "/week" || path === "/week.html") return "week";
  if (path === "/trends" || path === "/trends.html") return "trends";
  if (path === "/profile" || path === "/profile.html") return "profile";
  if (path === "/smoke-frontend" || path === "/smoke-frontend.html") return "smoke";
  return "home";
}

function isProtectedPath(pathname) {
  const path = String(pathname || "");
  return path === "/day" ||
    path === "/day.html" ||
    path === "/week" ||
    path === "/week.html" ||
    path === "/trends" ||
    path === "/trends.html" ||
    path === "/profile" ||
    path === "/profile.html";
}

function currentPathWithQuery() {
  if (typeof window === "undefined") return "/day";
  const { pathname = "/day", search = "", hash = "" } = window.location || {};
  return `${pathname}${search}${hash}`;
}

function redirectToLogin(nextPath = currentPathWithQuery()) {
  if (__suppressRedirect) {
    console.warn("[LN] redirect suppressed during personalization transition");
    return;
  }
  if (typeof window === "undefined") return;
  const currentPath = window.location?.pathname || "";
  if (currentPath === "/login" || currentPath === "/login.html") return;
  const next = nextPath || "/day";
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

function isAuthRequiredError(err) {
  const code = getErrorCode(err) || err?.code || null;
  return code === "AUTH_REQUIRED" || code === "auth_required" || Number(err?.httpStatus) === 401;
}

function parseJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function hasValidToken(token) {
  if (!token) return false;
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp > now;
}

function getRequestId(err) {
  return (
    err?.requestId ||
    err?.payload?.requestId ||
    err?.payload?.error?.requestId ||
    null
  );
}

function isProdLike() {
  const mode = getAppStateInternal()?.envMode;
  return mode === "alpha" || mode === "prod";
}

function attachUnhandledHook(routeError) {
  if (unhandledHookAttached) return;
  window.addEventListener("unhandledrejection", (event) => {
    const err = event?.reason || {};
    if (isAuthRequiredError(err)) {
      event.preventDefault();
      routeError(err);
      return;
    }
    if (isProdLike()) {
      event.preventDefault();
      const code = err?.code || "error";
      const req = err?.requestId ? ` ${err.requestId}` : "";
      console.warn(`[${code}]${req}`);
    } else {
      console.error(err);
    }
    routeError(err);
  });
  unhandledHookAttached = true;
}

function normalizeBootState(boot) {
  const uiState = boot?.uiState || "login";
  return {
    boot,
    auth: boot?.auth || {},
    consent: boot?.consent || {},
    now: boot?.now || null,
    authenticated: Boolean(boot?.auth?.isAuthenticated),
    consentComplete: Boolean(boot?.consent?.isComplete),
    uiState,
    envMode: boot?.env?.mode || boot?.envMode || null,
  };
}

async function runBootstrap() {
  const boot = await apiGet("/v1/bootstrap");
  const patch = normalizeBootState(boot);
  setAppState(patch);
  return { boot, patch };
}

function buildOnboardDefaults(boot) {
  return {
    timezone: boot?.baseline?.timezone || boot?.now?.tz || "America/Los_Angeles",
    dayBoundaryHour: boot?.baseline?.dayBoundaryHour ?? boot?.now?.dayBoundaryHour ?? 0,
    stress: "5",
    sleepQuality: "6",
    energy: "6",
  };
}

function setTodayNavEnabled(enabled) {
  const link = document.getElementById("nav-today");
  if (!link) return;
  if (enabled) {
    link.classList.remove("disabled");
    link.removeAttribute("aria-disabled");
    link.removeAttribute("tabindex");
  } else {
    link.classList.add("disabled");
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("tabindex", "-1");
  }
}

function setupConsentGate({ requiredKeys = null, requiredVersion = null, onAccepted, onError } = {}) {
  renderConsentScreen({ requiredKeys, requiredVersion, onAccepted, onError });
}

function routeErrorFactory(requestInit) {
  return function routeError(err) {
    const code = getErrorCode(err);
    const requestId = getRequestId(err);
    if (code === "AUTH_REQUIRED" || code === "auth_required") {
      clearTokens();
      redirectToLogin(currentPathWithQuery());
      return;
    }
    if (code === "consent_required" || code === "consent_required_version") {
      requestInit();
      return;
    }
    if (code === "incident_mode") {
      showIncidentScreen(requestId);
      return;
    }
    showErrorScreen({
      title: t("error.genericTitle"),
      message: t("error.genericBody"),
      requestId,
    });
  };
}

async function runSmoke() {
  const results = [];
  const add = (key, pass, details) => {
    results.push({ key, pass: Boolean(pass), details: details || null });
  };

  add("modules_loaded", true);

  let boot = null;
  try {
    boot = await apiGet("/v1/bootstrap");
    add("bootstrap", true, { uiState: boot?.uiState || null });
  } catch (err) {
    add("bootstrap", false, { message: err?.message || "bootstrap failed" });
  }

  if (boot?.uiState === "home") {
    try {
      await apiGet("/v1/rail/today");
      add("rail_today", true);
    } catch (err) {
      add("rail_today", false, { message: err?.message || "rail/today failed" });
    }
  } else {
    add("rail_today", true, { skipped: true });
  }

  const pass = results.every((entry) => entry.pass);
  const host = document.querySelector("main") || document.body;
  const title = document.createElement("h1");
  title.textContent = pass ? "Frontend smoke OK" : "Frontend smoke FAIL";
  const list = document.createElement("ul");
  results.forEach((entry) => {
    const item = document.createElement("li");
    const status = entry.pass ? "PASS" : "FAIL";
    const details = entry.details ? ` - ${JSON.stringify(entry.details)}` : "";
    item.textContent = `${status} ${entry.key}${details}`;
    list.appendChild(item);
  });
  host.innerHTML = "";
  host.appendChild(title);
  host.appendChild(list);
}

async function routeUiState({ boot, page, requestInit, routeError }) {
  const uiState = boot?.uiState || "login";
  hideGateScreens();
  setTodayNavEnabled(uiState === "home");

  if (page === "home" && uiState === "home") {
    window.location.assign("/day");
    return;
  }

  if (uiState === "login") {
    showLoginScreen();
    return;
  }

  if (uiState === "consent") {
    setupConsentGate({
      requiredKeys: boot?.consent?.requiredKeys || boot?.consent?.required || null,
      requiredVersion: boot?.consent?.requiredVersion ?? null,
      onAccepted: async () => requestInit(),
      onError: routeError,
    });
    return;
  }

  if (uiState === "onboard") {
    renderOnboardScreen({
      defaults: buildOnboardDefaults(boot),
      onComplete: async (res) => {
        if (res?.accessToken || res?.token) {
          setToken(res.accessToken || res.token);
        }
        if (res?.refreshToken) setRefreshToken(res.refreshToken);
        requestInit();
      },
      onError: routeError,
    });
    return;
  }

  if (uiState === "home") {
    const { renderHome, renderDay, renderWeek, renderTrends, renderProfile } = await loadControllers();
    if (page === "day") {
      await renderDay();
    } else if (page === "week") {
      await renderWeek();
    } else if (page === "trends") {
      await renderTrends();
    } else if (page === "profile") {
      await renderProfile();
    } else {
      await renderHome();
    }
    return;
  }

  showErrorScreen({
    title: t("error.genericTitle"),
    message: t("error.genericBody"),
  });
}

export async function bootstrapApp({ page } = {}) {
  const resolvedPage = page || resolvePage();
  if (resolvedPage === "home") return;
  const protectedPages = new Set(["day", "week", "trends", "profile"]);
  const path = typeof window !== "undefined" ? window.location?.pathname || "" : "";
  if ((protectedPages.has(resolvedPage) || isProtectedPath(path)) && !getToken()) {
    clearTokens();
    redirectToLogin(currentPathWithQuery());
    return;
  }
  if (initInFlight) {
    pendingInit = true;
    return;
  }

  let routeError = null;
  const requestInit = () => {
    if (initInFlight) {
      pendingInit = true;
      return;
    }
    void bootstrapApp({ page: resolvedPage });
  };

  initInFlight = true;
  if (resolvedPage === "day") {
    const dayIntro = document.querySelector("#day-intro");
    if (dayIntro) dayIntro.classList.add("hidden");
  }
  try {
    routeError = routeErrorFactory(requestInit);
    initBaseUi();
    attachUnhandledHook(routeError);
    setAppErrorHandler(routeError);
    await updateAdminVisibility();
    const hasAuthUi = Boolean(document.querySelector("#auth-email") || document.querySelector("#auth-request"));
    if (hasAuthUi) {
      bindAuth({
        onAuthChange: requestInit,
        onError: routeError,
      });
    }

    if (resolvedPage === "smoke") {
      await runSmoke();
      return;
    }

    const { boot } = await runBootstrap();
    await routeUiState({ boot, page: resolvedPage, requestInit, routeError });
  } catch (err) {
    if (isAuthRequiredError(err)) {
      console.log("[LN] session invalid, redirecting to login");
      clearTokens();
      redirectToLogin(currentPathWithQuery());
      return;
    }
    if (routeError) routeError(err);
    else reportError(err);
  } finally {
    initInFlight = false;
    if (resolvedPage === "day" && !getToken()) {
      const dayIntro = document.querySelector("#day-intro");
      if (dayIntro) dayIntro.classList.add("hidden");
      const onboarding = document.querySelector("#onboarding");
      if (onboarding) onboarding.classList.add("hidden");
      const dayApp = document.querySelector("#day-app");
      if (dayApp) dayApp.classList.add("hidden");
    }
    if (pendingInit) {
      pendingInit = false;
      void bootstrapApp({ page: resolvedPage });
    }
  }
}

function initDay({ initialDateISO } = {}) {
  console.log("[INIT_DAY] starting");
  if (!getToken()) {
    console.log("[LN] no token, redirecting");
    clearTokens();
    redirectToLogin(currentPathWithQuery());
    return;
  }
  console.log("[LN] token found, setting up");

  let currentContract = null;
  let currentDateISO = initialDateISO || todayISO();
  let stressBefore = 5;
  let energy = null;
  let sleepHours = 7;
  let wakeTime = null;
  let timeMin = null;
  let activeSessionInterval = null;

  function showPostSessionFeedback(sessionType, onDone) {
    const overlay = document.createElement("div");
    overlay.className = "post-session-overlay";
    overlay.innerHTML = `
      <div class="post-session-content">
        <h2>How do you feel?</h2>
        <div class="post-session-options">
          <button class="post-session-btn" data-value="better" type="button">Better</button>
          <button class="post-session-btn" data-value="same" type="button">Same</button>
          <button class="post-session-btn" data-value="not sure" type="button">Not sure</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll(".post-session-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const feedback = btn.dataset.value;
        try {
          apiPost("/v1/feedback", {
            type: sessionType,
            feeling: feedback,
            dateISO: currentDateISO,
          }).catch(() => {});
        } catch {}

        btn.style.background = "var(--primary, #b5a07c)";
        btn.style.color = "#fff";
        btn.style.borderColor = "var(--primary, #b5a07c)";

        setTimeout(() => {
          overlay.remove();
          onDone();
        }, 400);
      });
    });
  }


  function updateTodayPlan(updates) {
    try {
      const raw = localStorage.getItem("livenew_today");
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.assign(saved, updates);
      localStorage.setItem("livenew_today", JSON.stringify(saved));
    } catch {
      // ignore
      return null;
    }
  }


  const startGuidedExperience = (phases, config) => {
    LiveNewAudio.sessionStart();
    const instructionEl = qs(`#${config.instructionEl}`);
    const timerEl = qs(`#${config.timerEl}`);
    const skipBtn = qs(`#${config.skipBtn}`);
    const progressEl = qs(`#${config.progressEl || ""}`);
    const titleEl = qs(`#${config.titleEl || ""}`);
    const descEl = qs(`#${config.descriptionEl || ""}`);
    const ringEl = qs(`#${config.timerRingEl || ""}`);
    let phaseIndex = 0;
    let intervalId = null;
    let currentPhaseInstruction = "";
    const circumference = 339.292;

    function clearRevealTimer(el) {
      if (el?._revealTimer) {
        clearInterval(el._revealTimer);
        el._revealTimer = null;
      }
    }

    function revealInstructions(el, fullText, durationMs) {
      if (!el) return;
      clearRevealTimer(el);
      const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullText];
      if (sentences.length <= 1) {
        el.textContent = fullText;
        return;
      }

      let current = 0;
      el.textContent = sentences[0].trim();
      el.style.transition = "opacity 0.3s ease";
      const interval = Math.min(durationMs / sentences.length, 8000);
      const timer = setInterval(() => {
        current += 1;
        if (current >= sentences.length) {
          clearInterval(timer);
          el._revealTimer = null;
          return;
        }
        el.style.opacity = "0.5";
        setTimeout(() => {
          el.textContent = sentences.slice(0, current + 1).join(" ").trim();
          el.style.opacity = "1";
        }, 200);
      }, interval);
      el._revealTimer = timer;
    }

    const finish = () => {
      clearInterval(intervalId);
      clearRevealTimer(instructionEl);
      activeSessionInterval = null;
      LiveNewAudio.sessionComplete();
      if (typeof config.onComplete === "function") config.onComplete();
    };

    const runPhase = () => {
      if (phaseIndex >= phases.length) {
        finish();
        return;
      }
      const phase = phases[phaseIndex];
      const totalSec = Math.round((phase.minutes || 1) * 60);
      let remaining = totalSec;
      currentPhaseInstruction = phase?.instruction || "";
      if (progressEl) {
        progressEl.textContent = `${phaseIndex + 1} of ${phases.length}`;
      }
      if (phaseIndex > 0) {
        if (titleEl) titleEl.style.display = "none";
        if (descEl) descEl.style.display = "none";
      } else {
        if (titleEl) titleEl.style.display = "";
        if (descEl) descEl.style.display = "";
      }
      revealInstructions(instructionEl, currentPhaseInstruction, (phase.minutes || 1) * 60 * 1000);
      const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (timerEl) timerEl.textContent = fmt(remaining);
      if (ringEl) {
        ringEl.style.strokeDasharray = `${circumference}`;
        ringEl.style.strokeDashoffset = `${circumference}`;
      }
      clearInterval(intervalId);
      activeSessionInterval = null;
      intervalId = setInterval(() => {
        remaining -= 1;
        if (timerEl) timerEl.textContent = fmt(remaining);
        if (ringEl) {
          const progress = Math.max(0, remaining) / totalSec;
          ringEl.style.strokeDashoffset = `${circumference * progress}`;
        }
        if (remaining <= 0) {
          clearInterval(intervalId);
          clearRevealTimer(instructionEl);
          activeSessionInterval = null;
          if (phaseIndex < phases.length - 1) LiveNewAudio.phaseTransition();
          phaseIndex += 1;
          runPhase();
        }
      }, 1000);
      activeSessionInterval = intervalId;
    };

    if (skipBtn) {
      skipBtn.onclick = () => {
        clearInterval(intervalId);
        clearRevealTimer(instructionEl);
        if (instructionEl) instructionEl.textContent = currentPhaseInstruction;
        activeSessionInterval = null;
        if (phaseIndex < phases.length - 1) LiveNewAudio.phaseTransition();
        phaseIndex += 1;
        runPhase();
      };
    }

    runPhase();
  };

  function startGuidedReset(phases) {
    startGuidedExperience(phases, {
      instructionEl: "reset-instruction",
      timerEl: "reset-timer",
      timerRingEl: "reset-timer-ring",
      skipBtn: "reset-skip",
      progressEl: "reset-phase-progress",
      exitBtn: "#reset-exit",
      titleEl: "reset-title",
      descriptionEl: "reset-description",
      onComplete: () => showStep("after"),
    });
  }


  const onboardData = {};
  const onboardSteps = ["intro", "goal", "stress-baseline", "wake", "time", "injuries"];
  let onboardIndex = 0;
  const injuries = [];


  async function finishOnboarding() {
    const profile = {
      goal: onboardData.goal || "feel calmer",
      stressBaseline: onboardData.stressBaseline || "sometimes",
      wakeTime: onboardData.wakeTime || "normal",
      timeMin: Number(onboardData.timeMin) || 10,
      injuries: onboardData.injuries || [],
    };

    try {
      await apiPost("/v1/onboard/complete", { profile });
    } catch (err) {
      console.error("[ONBOARD_SAVE_ERROR]", err);
    }

    try {
      localStorage.setItem("livenew_profile", JSON.stringify(profile));
    } catch {}

    showStep("stress-tap");
  }

  document.querySelector(".onboard-intro-btn")?.addEventListener("click", () => {
    onboardIndex += 1;
    showOnboardStep(onboardSteps[onboardIndex]);
  });

  document.querySelectorAll("#day-step-onboard .onboard-opt:not(.onboard-toggle)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const value = btn.dataset.value;
      const parent = btn.parentElement;
      if (parent) {
        parent.querySelectorAll(".onboard-opt").forEach((b) => {
          b.style.background = b === btn ? "var(--primary, #b5a07c)" : "";
          b.style.color = b === btn ? "#fff" : "";
          b.style.borderColor = b === btn ? "var(--primary, #b5a07c)" : "";
        });
      }

      if (key === "injuries") {
        onboardData.injuries = value === "none" ? [] : [value];
      } else {
        onboardData[key] = value;
      }

      setTimeout(() => {
        onboardIndex += 1;
        if (onboardIndex < onboardSteps.length) {
          showOnboardStep(onboardSteps[onboardIndex]);
        } else {
          void finishOnboarding();
        }
      }, 300);
    });
  });

  document.querySelectorAll("#day-step-onboard .onboard-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;
      const idx = injuries.indexOf(value);
      if (idx >= 0) {
        injuries.splice(idx, 1);
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
      } else {
        injuries.push(value);
        btn.style.background = "var(--primary, #b5a07c)";
        btn.style.color = "#fff";
        btn.style.borderColor = "var(--primary, #b5a07c)";
      }
    });
  });

  const injuryStep = document.querySelector('#day-step-onboard [data-onboard="injuries"]');
  if (injuryStep) {
    const doneLink = document.createElement("button");
    doneLink.className = "ghost hidden";
    doneLink.style.cssText = "margin-top:16px;width:100%;font-size:0.9rem";
    doneLink.textContent = "Continue";
    injuryStep.appendChild(doneLink);

    doneLink.addEventListener("click", () => {
      onboardData.injuries = injuries.length > 0 ? injuries.slice() : [];
      onboardIndex += 1;
      void finishOnboarding();
    });

    document.querySelectorAll("#day-step-onboard .onboard-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        doneLink.classList.remove("hidden");
      });
    });
  }

  document.querySelectorAll(".stress-tap-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stressValue = Number(btn.dataset.value);
      stressBefore = stressValue;

      document.querySelectorAll(".stress-tap-btn").forEach((b) => {
        b.style.background = b === btn ? "var(--primary, #b5a07c)" : "";
        b.style.color = b === btn ? "#fff" : "";
        b.style.borderColor = b === btn ? "var(--primary, #b5a07c)" : "";
        b.disabled = true;
      });
      btn.textContent = "Building your plan...";

      const profile = await loadUserProfile();
      const stressBaselineMap = { rarely: 3, sometimes: 5, often: 7, always: 9 };
      const energyMap = { rarely: "high", sometimes: "med", often: "low", always: "low" };
      const baselineStress = stressBaselineMap[profile.stressBaseline] || 5;
      const energyLabel = energyMap[profile.stressBaseline] || "med";
      const energyScore = energyLabel === "low" ? 3 : energyLabel === "high" ? 9 : 6;
      const effectiveStress = Math.max(stressValue, baselineStress);

      try {
        const res = await apiPost("/v1/checkin", {
          checkIn: {
            dateISO: currentDateISO,
            stress: effectiveStress,
            energy: energyScore,
            sleepHours: 7,
            sleepQuality: 5,
            timeAvailableMin: profile.timeMin || 10,
            wakeTime: profile.wakeTime || "normal",
            goal: profile.goal || "feel calmer",
            injuries: profile.injuries || [],
          },
        });

        currentContract = res;
        currentDateISO = res?.dateISO || currentDateISO;
        wakeTime = profile.wakeTime || "normal";

        const move = res?.movement || res?.move || res?.workout;
        const reset = res?.reset;
        const winddown = res?.winddown;
        const hasContent =
          (move?.phases?.length > 0) ||
          (reset?.phases?.length > 0) ||
          (winddown?.phases?.length > 0);

        if (!hasContent) {
          btn.textContent = "Servers busy — tap again";
          document.querySelectorAll(".stress-tap-btn").forEach((b) => {
            b.disabled = false;
          });
          return;
        }

        saveTodayPlan(currentDateISO, res, effectiveStress, wakeTime);
        populateTodayScreen(res, effectiveStress, wakeTime);
        showStep("today");
        setTrialStarted();
        void requestNotificationPermission();
        scheduleNotifications(wakeTime);
      } catch (err) {
        if (isAuthRequiredError?.(err)) {
          clearTokens?.();
          redirectToLogin?.(currentPathWithQuery?.() || "/day");
          return;
        }
        btn.textContent = "Something went wrong — tap again";
        document.querySelectorAll(".stress-tap-btn").forEach((b) => {
          b.disabled = false;
        });
        reportError?.(err);
      }
    });
  });

  qs("#toggle-full-day")?.addEventListener("click", () => {
    const timeline = qs("#full-day-timeline");
    const btn = qs("#toggle-full-day");
    if (timeline) {
      const isHidden = timeline.classList.toggle("hidden");
      if (btn) btn.textContent = isHidden ? "See full day" : "Hide full day";
    }
  });

  qs("#recheckin-btn")?.addEventListener("click", () => {
    try { localStorage.removeItem("livenew_today"); } catch {}
    showStep("stress-tap");
  });

  qs("#paywall-subscribe")?.addEventListener("click", async () => {
    window.location.href = "https://buy.stripe.com/YOUR_STRIPE_LINK";
  });

  qs("#paywall-restore")?.addEventListener("click", async () => {
    try {
      const res = await apiGet("/v1/subscription/status");
      if (res?.active) {
        markSubscribed();
        showStep("stress-tap");
      } else {
        alert("No active subscription found. Please subscribe to continue.");
      }
    } catch {
      alert("Could not check subscription status. Please try again.");
    }
  });

  qs("#start-move")?.addEventListener("click", () => {
    const move = currentContract?.movement || currentContract?.move || currentContract?.workout;
    if (!move) return;
    const titleEl = qs("#move-title");
    const descEl = qs("#move-phase-description");
    if (titleEl) titleEl.textContent = move.title || "Your movement";
    if (descEl) descEl.textContent = move.description || "";
    showStep("move");
    startGuidedExperience(move.phases || [], {
      instructionEl: "move-instruction",
      timerEl: "move-timer",
      timerRingEl: "move-timer-ring",
      skipBtn: "move-skip",
      progressEl: "move-phase-progress",
      exitBtn: "#move-exit",
      titleEl: "move-title",
      descriptionEl: "move-phase-description",
      onComplete: async () => {
        try {
          await apiPost("/v1/move/complete", {
            dateISO: currentContract?.dateISO || currentDateISO,
            movementId: move.id || null,
          });
        } catch (err) {
          reportError(err);
        }
        updateTodayPlan({ moveCompleted: true });
        showPostSessionFeedback("move", () => {
          populateTodayScreen(currentContract, stressBefore, wakeTime);
          showStep("today");
        });
      },
    });
  });

  qs("#start-reset")?.addEventListener("click", () => {
    const reset = currentContract?.reset;
    if (!reset) return;
    const titleEl = qs("#reset-title");
    const descEl = qs("#reset-description");
    if (titleEl) titleEl.textContent = reset.title || "Your reset";
    if (descEl) descEl.textContent = reset.description || "";
    showStep("reset");
    startGuidedReset(reset.phases || []);
  });

  qs("#start-winddown")?.addEventListener("click", () => {
    const winddown = currentContract?.winddown;
    if (!winddown) return;
    const titleEl = qs("#winddown-title");
    const descEl = qs("#winddown-phase-description");
    if (titleEl) titleEl.textContent = winddown.title || "Wind-down";
    if (descEl) descEl.textContent = winddown.description || "";
    showStep("winddown");
    startGuidedExperience(winddown.phases || [], {
      instructionEl: "winddown-instruction",
      timerEl: "winddown-timer",
      timerRingEl: "winddown-timer-ring",
      skipBtn: "winddown-skip",
      progressEl: "winddown-phase-progress",
      exitBtn: "#winddown-exit",
      titleEl: "winddown-title",
      descriptionEl: "winddown-phase-description",
      onComplete: async () => {
        try {
          await apiPost("/v1/winddown/complete", {
            dateISO: currentContract?.dateISO || currentDateISO,
          });
        } catch (err) {
          reportError(err);
        }
        updateTodayPlan({ winddownCompleted: true });
        showPostSessionFeedback("winddown", () => {
          populateTodayScreen(currentContract, stressBefore, wakeTime);
          showStep("today");
        });
      },
    });
  });

  qs("#move-exit")?.addEventListener("click", () => {
    if (activeSessionInterval) {
      clearInterval(activeSessionInterval);
      activeSessionInterval = null;
    }
    showStep("today");
  });

  qs("#reset-exit")?.addEventListener("click", () => {
    if (activeSessionInterval) {
      clearInterval(activeSessionInterval);
      activeSessionInterval = null;
    }
    showStep("today");
  });

  qs("#winddown-exit")?.addEventListener("click", () => {
    if (activeSessionInterval) {
      clearInterval(activeSessionInterval);
      activeSessionInterval = null;
    }
    showStep("today");
  });

  // After (post-reset) slider
  const afterSlider = qs("#after-slider");
  const afterValEl = qs("#after-slider")?.closest(".slider-wrap")?.querySelector(".slider-value");
  afterSlider?.addEventListener("input", () => {
    if (afterValEl) afterValEl.textContent = afterSlider.value;
  });

  qs("#after-next")?.addEventListener("click", async () => {
    const stressAfter = Number(afterSlider?.value || 5);
    try {
      await apiPost("/v1/reset/complete", {
        dateISO: currentContract?.dateISO || currentDateISO,
        resetId: currentContract?.reset?.id || null,
        stressAfter,
        stressBefore,
      });
    } catch (err) {
      reportError(err);
    }
    updateTodayPlan({ resetCompleted: true });
    showPostSessionFeedback("reset", () => {
      populateTodayScreen(currentContract, stressBefore, wakeTime);
      showStep("today");
    });
  });

  // Entry point logic — determine which screen to show
  console.log("[ENTRY] reached entry point logic");
  try {
    const existingPlan = loadTodayPlan();
    if (existingPlan?.contract) {
      currentContract = existingPlan.contract;
      stressBefore = Number(existingPlan.stress || 5);
      wakeTime = existingPlan.wakeTime || "normal";
      populateTodayScreen(existingPlan.contract, existingPlan.stress, existingPlan.wakeTime);
      showStep("today");
      return;
    }
  } catch (err) {
    console.error("[ENTRY] loadTodayPlan failed:", err);
  }

  // Check if user has a saved profile
  let hasProfile = false;
  try {
    const cached = localStorage.getItem("livenew_profile");
    if (cached) {
      const p = JSON.parse(cached);
      if (p && p.goal) hasProfile = true;
    }
  } catch {}

  if (hasProfile) {
    if (isTrialExpired()) {
      showStep("paywall");
      return;
    }
    console.log("[ENTRY] has profile, showing stress-tap");
    showStep("stress-tap");
  } else {
    console.log("[ENTRY] no profile, showing onboard");
    showStep("onboard");
    showOnboardStep("intro");
  }
}

function initWeek() {
  const dateInput = qs("#week-date");
  const loadBtn = qs("#week-load");
  const list = qs("#week-list");
  if (dateInput) dateInput.value = todayISO();

  const loadWeek = async () => {
    const dateISO = dateInput?.value;
    const url = dateISO ? `/v1/plan/week?date=${dateISO}` : "/v1/plan/week";
    try {
      const res = await apiGet(url);
      clear(list);
      (res.weekPlan?.days || []).forEach((day) => {
        const total = (day.workout?.minutes || 0) + (day.reset?.minutes || 0);
        list.appendChild(
          el("div", { class: "list-item" }, [
            el("div", { text: `${day.dateISO} • ${day.profile} • ${day.focus}` }),
            el("div", { class: "muted", text: `${day.workout?.title || ""} + ${day.reset?.title || ""} (${total} min)` }),
          ])
        );
      });
    } catch (err) {
      if (isAuthRequiredError(err)) {
        clearTokens();
        redirectToLogin(currentPathWithQuery());
        return;
      }
      reportError(err);
    }
  };

  loadBtn?.addEventListener("click", () => {
    loadWeek();
  });
  loadWeek();
}

function initTrends() {
  const select = qs("#trends-days");
  const loadBtn = qs("#trends-load");
  const trendsList = qs("#trends-list");
  const outcomesList = qs("#outcomes-list");
  const resetsList = qs("#outcomes-resets-list");

  const loadTrends = async () => {
    try {
      const days = select?.value || "7";
      const res = await apiGet(`/v1/trends?days=${days}`);
      clear(trendsList);
      (res.days || []).forEach((row) => {
        trendsList?.appendChild(
          el("div", { class: "list-item" }, [
            el("div", { text: row.dateISO }),
            el("div", {
              class: "muted",
              text: `Stress ${row.stressAvg != null ? row.stressAvg.toFixed(1) : "–"} • Sleep ${row.sleepAvg != null ? row.sleepAvg.toFixed(1) : "–"} • Energy ${row.energyAvg != null ? row.energyAvg.toFixed(1) : "–"}`,
            }),
          ])
        );
      });
      const outcomes = await apiGet(`/v1/outcomes?days=${days}`);
      if (outcomesList) {
        clear(outcomesList);
        const resetRate = outcomes.metrics?.resetCompletionRate ?? 0;
        outcomesList.appendChild(el("div", { class: "list-item", text: `Rail opened days: ${String(outcomes.metrics?.railOpenedDays ?? 0)}` }));
        outcomesList.appendChild(el("div", { class: "list-item", text: `Reset completed days: ${String(outcomes.metrics?.resetCompletedDays ?? 0)}` }));
        outcomesList.appendChild(el("div", { class: "list-item", text: `Check-in submitted days: ${String(outcomes.metrics?.checkinSubmittedDays ?? 0)}` }));
        outcomesList.appendChild(el("div", { class: "list-item", text: `Reset completion rate: ${Math.round(resetRate * 100)}%` }));
      }
      if (resetsList) {
        clear(resetsList);
        (outcomes.metrics?.topResets || []).forEach((entry) => {
          resetsList.appendChild(
            el("div", { class: "list-item" }, [
              el("div", { text: entry.title || entry.resetId || "Reset" }),
              el("div", { class: "muted", text: `Completed ${String(entry.completedCount || 0)} • Last used ${entry.lastUsedAtISO || "–"}` }),
            ])
          );
        });
      }
    } catch (err) {
      if (isAuthRequiredError(err)) {
        clearTokens();
        redirectToLogin(currentPathWithQuery());
        return;
      }
      reportError(err);
    }
  };

  loadBtn?.addEventListener("click", () => {
    loadTrends();
  });
  loadTrends();
}

async function initProfile() {
  const goalLabels = {
    calmer: "Feel calmer",
    energy: "More energy",
    sleep: "Better sleep",
    weight: "Weight stability",
  };

  let currentGoal = "";

  try {
    const res = await apiGet("/v1/profile");
    const profile = res?.profile || res?.userProfile || {};
    currentGoal = profile.goal || profile.primaryGoal || "";

    const emailEl = qs("#profile-email");
    if (emailEl && profile.email) emailEl.textContent = profile.email;

    const goalDisplay = qs("#profile-goal-display");
    if (goalDisplay) {
      goalDisplay.textContent = goalLabels[currentGoal] || currentGoal || "Not set";
    }
  } catch (err) {
    if (isAuthRequiredError(err)) {
      clearTokens();
      redirectToLogin(currentPathWithQuery());
      return;
    }
  }

  try {
    const data = await apiGet("/v1/progress");
    if (data?.ok) {
      const p = data.progress || {};
      const checkinsEl = qs("#profile-stat-checkins");
      const stressEl = qs("#profile-stat-stress");
      const resetsEl = qs("#profile-stat-resets");
      if (checkinsEl) checkinsEl.textContent = String(p.consistency?.checkinDays || 0);
      if (stressEl) stressEl.textContent = p.stressAvg7 != null ? Number(p.stressAvg7).toFixed(1) : "—";
      if (resetsEl) resetsEl.textContent = String(p.consistency?.resetsCompleted || 0);
    }
  } catch {
    // Stats fail silently — show dashes
  }

  const changeBtn = qs("#profile-goal-change");
  const picker = qs("#profile-goal-picker");
  const goalDisplay = qs("#profile-goal-display");
  const goalStatus = qs("#profile-goal-status");

  changeBtn?.addEventListener("click", () => {
    picker?.classList.toggle("hidden");
    qsa("#profile-goals .goal-opt").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === currentGoal);
    });
  });

  qsa("#profile-goals .goal-opt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newGoal = btn.dataset.value;
      qsa("#profile-goals .goal-opt").forEach((b) => b.classList.toggle("active", b === btn));
      try {
        await apiPost("/v1/profile", { userProfile: { goal: newGoal } });
        currentGoal = newGoal;
        if (goalDisplay) goalDisplay.textContent = goalLabels[newGoal] || newGoal;
        if (goalStatus) goalStatus.textContent = "Saved";
        setTimeout(() => {
          if (goalStatus) goalStatus.textContent = "";
          picker?.classList.add("hidden");
        }, 1000);
      } catch {
        if (goalStatus) goalStatus.textContent = "Failed to save";
      }
    });
  });

  qs("#profile-logout")?.addEventListener("click", async () => {
    try {
      await logoutAuth();
    } catch {
      // ignore
    }
    clearTokens();
    window.location.href = "/login";
  });
}

function initAdmin() {
  const guardText = qs("#admin-guard-text");
  const panel = qs("#admin-panel");
  const guard = qs("#admin-guard");
  const validatorBanner = qs("#admin-validator-banner");
  const validatorStatus = qs("#validator-status");
  const validatorOutput = qs("#validator-output");
  const outlineOutput = qs("#outline-output");
  const outlineStatus = qs("#outline-status");
  const opsStatus = qs("#ops-status");
  const opsValidatorList = qs("#ops-validator-list");
  const opsWorstList = qs("#ops-worst-list");
  const opsErrorsList = qs("#ops-errors-list");
  const opsLatencyBody = qs("#ops-latency-table tbody");
  const opsReleaseList = qs("#ops-release-checklist");
  const opsSnapshotSummary = qs("#ops-snapshot-summary");
  const opsDailyList = qs("#ops-daily-list");
  const opsMetricsList = qs("#ops-metrics");
  const snapshotStatus = qs("#snapshot-status");
  const snapshotDetail = qs("#snapshot-detail");
  const snapshotDiffOutput = qs("#snapshot-diff-output");
  const snapshotRepinOutput = qs("#snapshot-repin-output");

  const showPanel = (ok) => {
    if (ok) {
      guard.classList.add("hidden");
      panel.classList.remove("hidden");
    } else {
      guard.classList.remove("hidden");
      panel.classList.add("hidden");
    }
  };

  const checkAdmin = async () => {
    try {
      const res = await apiGet("/v1/admin/me");
      if (!res.isAdmin) {
        setText(guardText, t("admin.guard"));
        showPanel(false);
        return false;
      }
      showPanel(true);
      return true;
    } catch {
      setText(guardText, t("admin.guard"));
      showPanel(false);
      return false;
    }
  };

  const initTabs = () => {
    qsa(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        qsa(".tab").forEach((btn) => btn.classList.remove("active"));
        tab.classList.add("active");
        const target = tab.dataset.tab;
        qsa(".tab-panel").forEach((panel) => {
          panel.classList.toggle("hidden", panel.dataset.panel !== target);
        });
      });
    });
  };

  const parseCommaList = (value) =>
    String(value || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  let stageModeEnabled = false;
  const stageModeInputs = [qs("#sc-stage-mode"), qs("#matrix-stage-mode")].filter(Boolean);
  const setStageMode = (value) => {
    stageModeEnabled = Boolean(value);
    stageModeInputs.forEach((input) => {
      input.checked = stageModeEnabled;
    });
  };
  stageModeInputs.forEach((input) => {
    input.addEventListener("change", () => setStageMode(input.checked));
  });
  const stageHeaders = () => (stageModeEnabled ? { "x-content-stage": "true" } : undefined);

  const renderValidatorBanner = (latest) => {
    if (!validatorBanner) return;
    if (latest && latest.releaseBlocked) {
      validatorBanner.textContent = t("admin.releaseBlocked");
      validatorBanner.classList.remove("hidden");
    } else {
      validatorBanner.classList.add("hidden");
      validatorBanner.textContent = "";
    }
  };

  const loadValidatorLatest = async () => {
    const res = await apiGet("/v1/admin/validator/latest");
    const latest = res.latest || null;
    renderValidatorBanner(res);
    if (validatorStatus) {
      const kind = latest?.kind || res.kind || "engine_matrix";
      validatorStatus.textContent = latest
        ? `${kind} • ${latest.atISO} • ${latest.ok ? t("admin.ok") : t("admin.failed")}`
        : t("admin.noRuns");
    }
    if (validatorOutput) {
      validatorOutput.textContent = latest ? JSON.stringify(latest.report || {}, null, 2) : "";
    }
  };

  const runValidatorNow = async () => {
    if (validatorStatus) validatorStatus.textContent = t("admin.running");
    const res = await apiPost("/v1/admin/validator/run", { kind: "engine_matrix" });
    if (validatorStatus) {
      validatorStatus.textContent = res.report?.ok ? t("admin.ok") : t("admin.failed");
    }
    if (validatorOutput) validatorOutput.textContent = JSON.stringify(res.report || {}, null, 2);
    renderValidatorBanner({ releaseBlocked: res.report ? !res.report.ok : false });
  };

  const loadOpsDashboard = async () => {
    if (opsStatus) opsStatus.textContent = t("admin.loading");
    const ops = await apiGet("/v1/admin/ops/status");
    if (opsStatus) {
      const validatorOk = ops.validator?.latestOk ? t("admin.ok") : t("admin.failed");
      const loadtestOk = ops.loadtest?.latestOk ? t("admin.ok") : t("admin.failed");
      opsStatus.textContent = `${t("admin.validator")}: ${validatorOk} • ${t("admin.loadtest")}: ${loadtestOk}`;
    }
    if (opsReleaseList) {
      clear(opsReleaseList);
      const checklist = ops.releaseChecklistPass ? t("admin.ok") : t("admin.failed");
      opsReleaseList.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { text: `${t("admin.releaseChecklist")}: ${checklist}` }),
          el("div", { class: "muted", text: `${t("admin.backupsOk")}: ${ops.backups?.latestAtISO || "—"}` }),
        ])
      );
    }
    if (opsSnapshotSummary) {
      clear(opsSnapshotSummary);
      opsSnapshotSummary.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { text: `${t("admin.defaultSnapshot")}: ${ops.snapshots?.defaultSnapshotId || "—"}` }),
          el("div", { class: "muted", text: `${t("admin.latestReleasedSnapshot")}: ${ops.snapshots?.latestReleasedSnapshotId || "—"}` }),
        ])
      );
    }
    if (opsLatencyBody) {
      clear(opsLatencyBody);
      const entries = Object.entries(ops.loadtest?.p95ByRoute || {}).sort((a, b) => a[0].localeCompare(b[0]));
      if (!entries.length) {
        opsLatencyBody.appendChild(
          el("tr", {}, [el("td", { text: "—" }), el("td", { text: "—" })])
        );
      } else {
        entries.forEach(([route, p95]) => {
          opsLatencyBody.appendChild(
            el("tr", {}, [el("td", { text: route }), el("td", { text: `${Math.round(p95)}ms` })])
          );
        });
      }
    }

    const latestValidator = await apiGet("/v1/admin/validator/latest");
    if (opsValidatorList) {
      clear(opsValidatorList);
      const report = latestValidator.latest?.report || null;
      const failures = report?.failures || [];
      if (!failures.length) {
        opsValidatorList.appendChild(el("div", { class: "list-item muted", text: t("admin.noFailures") }));
      } else {
        failures.slice(0, 12).forEach((failure) => {
          opsValidatorList.appendChild(
            el("div", { class: "list-item" }, [
              el("div", { text: `${failure.profile || ""} • ${failure.timeAvailableMin || ""}m • ${failure.packId || ""}` }),
              el("div", { class: "muted", text: `${failure.code || ""} ${failure.message || ""}` }),
            ])
          );
        });
      }
    }

    if (opsWorstList) {
      clear(opsWorstList);
      const kinds = ["workout", "reset", "nutrition"];
      for (const kind of kinds) {
        const res = await apiGet(`/v1/admin/reports/worst-items?kind=${kind}&limit=3`);
        (res.items || []).forEach((entry) => {
          const item = entry.item || {};
          const stats = entry.stats || {};
          opsWorstList.appendChild(
            el("div", { class: "list-item" }, [
              el("div", { text: `${kind} • ${item.title || item.id || ""}` }),
              el("div", { class: "muted", text: `${t("admin.notRelevantRate")}: ${formatPct(stats.notRelevantRate)}` }),
            ])
          );
        });
      }
    }

    const errors = await apiGet("/v1/admin/monitoring/errors");
    if (opsErrorsList) {
      clear(opsErrorsList);
      const entries = errors.errors || [];
      if (!entries.length) {
        opsErrorsList.appendChild(el("div", { class: "list-item muted", text: t("admin.noErrors") }));
      } else {
        entries.slice(0, 10).forEach((entry) => {
          opsErrorsList.appendChild(
            el("div", { class: "list-item" }, [
              el("div", { text: `${entry.code} • ${entry.routeKey}` }),
              el("div", { class: "muted", text: `${entry.count} • ${entry.lastSeenAtISO || ""}` }),
            ])
          );
        });
      }
    }

    const opsDaily = await apiGet("/v1/admin/ops/daily");
    if (opsDailyList) {
      clear(opsDailyList);
      (opsDaily.checklist || []).forEach((item) => {
        const status = item.ok ? t("admin.ok") : t("admin.failed");
        let detailText = "";
        if (item.key === "validator_ok") {
          detailText = item.details?.latestAtISO ? `${item.details.latestAtISO}` : "";
        } else if (item.key === "top_errors") {
          detailText = item.details?.top?.length ? `${item.details.top.length} ${t("admin.entries")}` : t("admin.none");
        } else if (item.key === "p95_latency") {
          detailText = Object.keys(item.details?.p95ByRoute || {}).length ? t("admin.viewDetails") : t("admin.none");
        } else if (item.key === "stability_distribution") {
          const total = item.details?.total || 0;
          detailText = total ? `${t("admin.totalUsers")}: ${total}` : t("admin.none");
        }
        opsDailyList.appendChild(
          el("div", { class: "list-item" }, [
            el("div", { text: `${item.key} • ${status}` }),
            el("div", { class: "muted", text: detailText }),
          ])
        );
      });
    }

    if (opsMetricsList) {
      clear(opsMetricsList);
      const windows = [7, 14, 30];
      const qualityCalls = windows.map((days) => apiGet(`/v1/admin/metrics/quality?days=${days}`));
      const retentionCalls = windows.map((days) => apiGet(`/v1/admin/metrics/retention?days=${days}`));
      const qualityResults = await Promise.all(qualityCalls);
      const retentionResults = await Promise.all(retentionCalls);
      windows.forEach((days, idx) => {
        const quality = qualityResults[idx];
        const retention = retentionResults[idx];
        const qualityPct = formatPct(quality.rate);
        const retentionPct = formatPct(retention.overall?.rate);
        opsMetricsList.appendChild(
          el("div", { class: "list-item" }, [
            el("div", { text: `Last ${days}d • ${t("admin.qualityMetric")}: ${qualityPct}` }),
            el("div", { class: "muted", text: `${t("admin.retentionMetric")}: ${retentionPct}` }),
          ])
        );
      });
    }
  };

  const buildOutlinePayload = () => {
    const kind = qs("#outline-kind")?.value || "workout";
    const outlineText = qs("#outline-text")?.value || "";
    const tags = qs("#outline-tags")?.value || "";
    const minutesHint = qs("#outline-minutes")?.value;
    return {
      kind,
      outlineText,
      suggestedTags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      minutesHint: minutesHint ? Number(minutesHint) : undefined,
    };
  };

  const previewOutline = async () => {
    const payload = buildOutlinePayload();
    if (outlineStatus) outlineStatus.textContent = "";
    try {
      const res = await apiPost("/v1/admin/content/from-outline?preview=true", payload);
      if (outlineOutput) outlineOutput.textContent = JSON.stringify(res, null, 2);
      if (outlineStatus) outlineStatus.textContent = t("admin.previewReady");
    } catch (err) {
      const details = getErrorDetails(err);
      if (outlineOutput) outlineOutput.textContent = JSON.stringify(details || {}, null, 2);
      if (outlineStatus) outlineStatus.textContent = t("admin.previewFailed");
    }
  };

  const saveOutlineDraft = async () => {
    const payload = buildOutlinePayload();
    if (outlineStatus) outlineStatus.textContent = "";
    try {
      const res = await apiPost("/v1/admin/content/from-outline", payload);
      if (outlineOutput) outlineOutput.textContent = JSON.stringify(res, null, 2);
      if (outlineStatus) outlineStatus.textContent = t("misc.saved");
      scLoadList();
    } catch (err) {
      const details = getErrorDetails(err);
      if (outlineOutput) outlineOutput.textContent = JSON.stringify(details || {}, null, 2);
      if (outlineStatus) outlineStatus.textContent = t("admin.previewFailed");
    }
  };

  const loadContentList = async () => {
    const kind = qs("#admin-kind")?.value || "workout";
    const res = await apiGet(`/v1/admin/content?kind=${kind}&page=1&pageSize=200`);
    const list = qs("#admin-content-list");
    clear(list);
    (res.items || []).forEach((item) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: item.title || item.id }),
        el("div", { class: "muted", text: `${item.enabled === false ? t("admin.disabled") : t("admin.enabled")} • ${t("admin.priority").toLowerCase()} ${item.priority}` }),
      ]);
      row.addEventListener("click", () => populateEditor(kind, item));
      list.appendChild(row);
    });
  };

  let currentItem = null;
  const populateEditor = (kind, item) => {
    currentItem = { kind, item };
    qs("#content-title").value = item.title || "";
    qs("#content-enabled").value = item.enabled === false ? "false" : "true";
    qs("#content-priority").value = item.priority || 0;
    qs("#content-novelty").value = item.noveltyGroup || "";
    qs("#content-minutes").value = item.minutes || "";
    qs("#content-tags").value = (item.tags || []).join(", ");
    const steps = kind === "nutrition" ? (item.priorities || []) : (item.steps || []);
    qs("#content-steps").value = (steps || []).join("\n");
  };

  const saveEditor = async () => {
    if (!currentItem) return;
    const kind = currentItem.kind;
    const id = currentItem.item.id;
    const tags = qs("#content-tags").value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const stepsRaw = qs("#content-steps").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const patch = {
      title: qs("#content-title").value,
      enabled: qs("#content-enabled").value === "true",
      priority: Number(qs("#content-priority").value || 0),
      noveltyGroup: qs("#content-novelty").value,
      minutes: Number(qs("#content-minutes").value || 0),
      tags,
    };
    if (kind === "nutrition") patch.priorities = stepsRaw;
    else patch.steps = stepsRaw;
    await apiPatch(`/v1/admin/content/${kind}/${id}`, patch);
    loadContentList();
  };

  const disableItem = async () => {
    if (!currentItem) return;
    const kind = currentItem.kind;
    const id = currentItem.item.id;
    await apiPost(`/v1/admin/content/${kind}/${id}/disable`, {});
    loadContentList();
  };

  let scCurrent = null;
  const scStatusText = qs("#sc-status-text");
  const scSetStatus = (textKey, extra = "") => {
    if (!scStatusText) return;
    const base = textKey ? t(textKey) : "";
    scStatusText.textContent = extra ? `${base} ${extra}` : base;
  };
  const scReportOutput = qs("#sc-report-output");
  const scReportsList = qs("#sc-reports");

  const scPopulateEditor = (kind, item) => {
    scCurrent = { kind, item };
    if (qs("#sc-id")) {
      qs("#sc-id").textContent = item?.id ? `${t("admin.item")}: ${item.id} • ${t("admin.status")}: ${item.status || ""}` : "";
    }
    if (qs("#sc-title")) qs("#sc-title").value = item?.title || "";
    if (qs("#sc-priority")) qs("#sc-priority").value = item?.priority || 0;
    if (qs("#sc-minutes")) qs("#sc-minutes").value = item?.minutes || "";
    if (qs("#sc-novelty")) qs("#sc-novelty").value = item?.noveltyGroup || "";
    if (qs("#sc-tags")) qs("#sc-tags").value = (item?.tags || []).join(", ");
    const steps = kind === "nutrition" ? item?.priorities || [] : item?.steps || [];
    if (qs("#sc-steps")) qs("#sc-steps").value = (steps || []).join("\n");
  };

  const scCollectItem = (kind) => {
    const tags = (qs("#sc-tags")?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const stepsRaw = (qs("#sc-steps")?.value || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const base = {
      id: scCurrent?.item?.id,
      title: qs("#sc-title")?.value || "",
      priority: Number(qs("#sc-priority")?.value || 0),
      noveltyGroup: qs("#sc-novelty")?.value || "",
      minutes: Number(qs("#sc-minutes")?.value || 0),
      tags,
      enabled: true,
    };
    if (kind === "nutrition") base.priorities = stepsRaw;
    else base.steps = stepsRaw;
    return base;
  };

  const scLoadList = async () => {
    const kind = qs("#sc-kind")?.value || "workout";
    const status = qs("#sc-status")?.value || "draft";
    const res = await apiGet(`/v1/admin/content?kind=${kind}&status=${status}&page=1&pageSize=200`);
    const list = qs("#sc-list");
    if (!list) return;
    clear(list);
    (res.items || []).forEach((item) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: item.title || item.id }),
        el("div", { class: "muted", text: `${item.status || ""} • ${t("admin.priority").toLowerCase()} ${item.priority ?? 0}` }),
      ]);
      row.addEventListener("click", () => scPopulateEditor(kind, item));
      list.appendChild(row);
    });
    scSetStatus("", "");
  };

  const scSaveDraft = async () => {
    const kind = qs("#sc-kind")?.value || "workout";
    const item = scCollectItem(kind);
    const res = await apiPost("/v1/admin/content/draft", { kind, item });
    scPopulateEditor(kind, res.item);
    scSetStatus("admin.saveDraft");
    await scLoadList();
  };

  const scStage = async () => {
    if (!scCurrent?.item?.id) return;
    const { kind, item } = scCurrent;
    const res = await apiPost(`/v1/admin/content/stage/${kind}/${encodeURIComponent(item.id)}`, {});
    scPopulateEditor(kind, res.item);
    scSetStatus("admin.stage");
    await scLoadList();
  };

  const scEnable = async () => {
    if (!scCurrent?.item?.id) return;
    const { kind, item } = scCurrent;
    const res = await apiPost(`/v1/admin/content/enable/${kind}/${encodeURIComponent(item.id)}`, {});
    scPopulateEditor(kind, res.item);
    scSetStatus("admin.enable");
    await scLoadList();
  };

  const scDisable = async () => {
    if (!scCurrent?.item?.id) return;
    const { kind, item } = scCurrent;
    const res = await apiPost(`/v1/admin/content/disable/${kind}/${encodeURIComponent(item.id)}`, {});
    scPopulateEditor(kind, res.item);
    scSetStatus("admin.disable");
    await scLoadList();
  };

  const scValidate = async () => {
    const scope = qs("#sc-scope")?.value || "all";
    const res = await apiPost("/v1/admin/content/validate", { scope });
    if (scReportOutput) {
      scReportOutput.textContent = JSON.stringify(res.report || {}, null, 2);
    }
    scSetStatus("admin.validate");
    await scLoadReports();
  };

  const scLoadReports = async () => {
    const res = await apiGet("/v1/admin/content/validation-reports?limit=20");
    if (!scReportsList) return;
    clear(scReportsList);
    (res.reports || []).forEach((entry) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${entry.atISO || ""} • ${entry.scope || ""}` }),
        el("div", { class: "muted", text: `${(entry.report?.errors || []).length} errors • ${(entry.report?.warnings || []).length} warnings` }),
      ]);
      row.addEventListener("click", () => {
        if (scReportOutput) scReportOutput.textContent = JSON.stringify(entry.report || {}, null, 2);
      });
      scReportsList.appendChild(row);
    });
  };

  const loadWorst = async () => {
    const kind = qs("#worst-kind")?.value || "workout";
    const res = await apiGet(`/v1/admin/reports/worst-items?kind=${kind}&limit=20`);
    const list = qs("#worst-list");
    clear(list);
    (res.items || []).forEach((entry) => {
      const item = entry.item;
      const stats = entry.stats || {};
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${item.title || item.id}` }),
        el("div", { class: "muted", text: `${t("admin.picked")} ${stats.picked} • ${t("admin.notRelevant")} ${formatPct(stats.notRelevantRate)}` }),
      ]);
      const btn = el("button", { text: t("admin.disable"), class: "ghost" });
      btn.addEventListener("click", async () => {
        await apiPost(`/v1/admin/content/${kind}/${item.id}/disable`, {});
        loadWorst();
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  };

  const loadHeatmap = async () => {
    const kind = qs("#heatmap-kind")?.value || "workout";
    const res = await apiGet(`/v1/admin/stats/content?kind=${kind}`);
    const tbody = qs("#heatmap-table tbody");
    clear(tbody);
    (res.items || []).forEach((entry) => {
      const item = entry.item;
      const stats = entry.stats || {};
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: item.title || item.id }),
          el("td", { text: stats.picked || 0 }),
          el("td", { text: stats.completed || 0 }),
          el("td", { text: stats.notRelevant || 0 }),
          el("td", { text: formatPct(stats.completionRate) }),
          el("td", { text: formatPct(stats.notRelevantRate) }),
        ])
      );
    });
  };

  let weeklyReportData = null;
  const loadWeeklyReport = async () => {
    const res = await apiGet("/v1/admin/reports/weekly-content");
    weeklyReportData = res.report || null;
    const pre = qs("#weekly-report");
    if (pre) {
      pre.textContent = JSON.stringify(res.report || {}, null, 2);
    }
  };

  const downloadWeeklyReport = async () => {
    if (!weeklyReportData) {
      await loadWeeklyReport();
    }
    if (!weeklyReportData) return;
    const blob = new Blob([JSON.stringify(weeklyReportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weekly-report-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const disableWeeklyCandidates = async () => {
    const items = weeklyReportData?.suggestedActions?.disableCandidates || [];
    if (!items.length) return;
    await apiPost("/v1/admin/actions/disable-items", { items });
    loadContentList();
    loadWorst();
    loadWeeklyReport();
  };

  const bumpWeeklyPriority = async () => {
    const kind = qs("#weekly-bump-kind")?.value;
    const id = qs("#weekly-bump-id")?.value?.trim();
    const deltaRaw = Number(qs("#weekly-bump-delta")?.value || 0);
    const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
    if (!kind || !id || !delta) return;
    await apiPost("/v1/admin/actions/bump-priority", { items: [{ kind, id, delta }] });
    loadContentList();
    loadWeeklyReport();
  };

  const loadParameters = async () => {
    const res = await apiGet("/v1/admin/parameters");
    const list = qs("#params-list");
    clear(list);
    Object.entries(res.parameters || {}).forEach(([key, value]) => {
      const textarea = el("textarea", { rows: 6 }, []);
      textarea.value = JSON.stringify(value, null, 2);
      const saveBtn = el("button", { text: t("admin.save"), class: "ghost" });
      saveBtn.addEventListener("click", async () => {
        await apiPatch("/v1/admin/parameters", { key, value_json: textarea.value });
      });
      const block = el("div", { class: "list-item" }, [
        el("div", { text: key }),
        textarea,
        saveBtn,
      ]);
      list.appendChild(block);
    });
  };

  let packsCache = [];
  let currentPackId = null;
  const setPacksStatus = (messageKey) => {
    const elStatus = qs("#packs-status");
    if (!elStatus) return;
    elStatus.textContent = messageKey ? t(messageKey) : "";
  };

  const loadPackDetail = async (packId) => {
    if (!packId) return;
    const res = await apiGet(`/v1/admin/packs/${encodeURIComponent(packId)}`);
    const pack = res.pack;
    currentPackId = pack?.id || packId;
    if (qs("#packs-name")) qs("#packs-name").value = pack?.name || currentPackId;
    if (qs("#packs-weights")) qs("#packs-weights").value = JSON.stringify(pack?.weights || {}, null, 2);
    if (qs("#packs-constraints")) qs("#packs-constraints").value = JSON.stringify(pack?.constraints || {}, null, 2);
    setPacksStatus("admin.packLoaded");
  };

  const loadPacksList = async () => {
    const res = await apiGet("/v1/admin/packs");
    packsCache = res.packs || [];
    const select = qs("#packs-select");
    if (!select) return;
    clear(select);
    packsCache.forEach((pack) => {
      const opt = el("option", { text: `${pack.name || pack.id} (${pack.id})` });
      opt.value = pack.id;
      select.appendChild(opt);
    });
    currentPackId = select.value || packsCache[0]?.id || null;
    if (currentPackId) {
      select.value = currentPackId;
      await loadPackDetail(currentPackId);
    }
  };

  const savePack = async () => {
    const packId = qs("#packs-select")?.value || currentPackId;
    if (!packId) return;
    try {
      const weights = JSON.parse(qs("#packs-weights")?.value || "{}");
      const constraints = JSON.parse(qs("#packs-constraints")?.value || "{}");
      const name = qs("#packs-name")?.value?.trim() || packId;
      await apiPatch(`/v1/admin/packs/${encodeURIComponent(packId)}`, {
        name,
        weights_json: weights,
        constraints_json: constraints,
      });
      await loadPacksList();
      setPacksStatus("admin.packSaved");
    } catch {
      setPacksStatus("admin.invalidJson");
    }
  };

  let experimentsCache = [];
  const setExperimentsStatus = (message, extra = "") => {
    const elStatus = qs("#experiments-status");
    if (!elStatus) return;
    const base = message ? t(message) : "";
    if (!base) {
      elStatus.textContent = extra || "";
      return;
    }
    elStatus.textContent = extra ? `${base} ${extra}` : base;
  };

  const renderExperiments = (experiments) => {
    const list = qs("#experiments-list");
    if (!list) return;
    clear(list);
    (experiments || []).forEach((exp) => {
      const config = exp.config || {};
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${exp.name || exp.id} (${exp.id})` }),
        el("div", { class: "muted", text: `${exp.status || ""} • ${config.type || ""}` }),
      ]);
      const startBtn = el("button", { class: "ghost", text: t("admin.running") });
      startBtn.addEventListener("click", async () => {
        await apiPost(`/v1/admin/experiments/${encodeURIComponent(exp.id)}/start`, {});
        await loadExperiments();
      });
      const stopBtn = el("button", { class: "ghost", text: t("admin.stopped") });
      stopBtn.addEventListener("click", async () => {
        await apiPost(`/v1/admin/experiments/${encodeURIComponent(exp.id)}/stop`, {});
        await loadExperiments();
      });
      row.appendChild(startBtn);
      row.appendChild(stopBtn);
      list.appendChild(row);
    });
  };

  const loadExperiments = async () => {
    const res = await apiGet("/v1/admin/experiments");
    experimentsCache = res.experiments || [];
    renderExperiments(experimentsCache);
    setExperimentsStatus("");
  };

  const createExperiment = async () => {
    const name = qs("#exp-name")?.value?.trim();
    if (!name) {
      setExperimentsStatus("", t("admin.name"));
      return;
    }
    let config = {};
    try {
      config = JSON.parse(qs("#exp-config")?.value || "{}");
    } catch {
      setExperimentsStatus("admin.invalidJson");
      return;
    }
    const status = qs("#exp-status")?.value || "draft";
    await apiPost("/v1/admin/experiments", { name, status, config_json: config });
    await loadExperiments();
  };

  const loadExperimentAssignments = async (experimentIdOverride = null) => {
    const experimentId = experimentIdOverride || qs("#exp-assign-id")?.value?.trim();
    if (!experimentId) return;
    const res = await apiGet(`/v1/admin/experiments/${encodeURIComponent(experimentId)}/assignments?page=1&pageSize=50`);
    if (qs("#experiments-assignments")) {
      qs("#experiments-assignments").textContent = JSON.stringify(res.items || [], null, 2);
    }
  };

  const renderMatrix = (rows) => {
    const tbody = qs("#matrix-table tbody");
    if (!tbody) return;
    clear(tbody);
    rows.forEach((row) => {
      const picked = row.picked || {};
      const meta = row.meta || {};
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: row.profile || "" }),
          el("td", { text: String(row.timeAvailableMin ?? "") }),
          el("td", { text: row.packId || "" }),
          el("td", { text: picked.workoutId || "—" }),
          el("td", { text: picked.resetId || "—" }),
          el("td", { text: picked.nutritionId || "—" }),
          el("td", { text: meta.confidence != null ? meta.confidence.toFixed(2) : "" }),
          el("td", { text: meta.relevance != null ? meta.relevance.toFixed(2) : "" }),
          el("td", { text: (meta.appliedRulesTop || []).slice(0, 3).join(", ") }),
        ])
      );
    });
  };

  const runPreviewMatrix = async () => {
    const packIds = parseCommaList(qs("#matrix-pack-ids")?.value);
    const profiles = parseCommaList(qs("#matrix-profiles")?.value);
    const timeBuckets = parseCommaList(qs("#matrix-time-buckets")?.value)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const baseInputs = {
      sleepQuality: Number(qs("#matrix-sleep")?.value || 6),
      stress: Number(qs("#matrix-stress")?.value || 5),
      energy: Number(qs("#matrix-energy")?.value || 6),
    };
    const headers = stageHeaders();
    const res = await apiPost(
      "/v1/admin/preview/matrix",
      {
        packIds,
        profiles,
        timeBuckets,
        baseInputs,
      },
      { headers }
    );
    if (typeof res.stageMode === "boolean") {
      setStageMode(res.stageMode);
    }
    renderMatrix(res.matrix || []);
  };

  let snapshotsCache = [];
  let currentSnapshotId = null;
  let defaultSnapshotId = null;
  const setSnapshotStatus = (messageKey, extra = "") => {
    if (!snapshotStatus) return;
    const base = messageKey ? t(messageKey) : "";
    snapshotStatus.textContent = extra ? `${base} ${extra}` : base;
  };
  const fillSnapshotSelect = (select, options, value = "") => {
    if (!select) return;
    clear(select);
    options.forEach((snap) => {
      const opt = el("option", { text: snap.id });
      opt.value = snap.id;
      select.appendChild(opt);
    });
    if (value) select.value = value;
  };
  const renderSnapshotList = () => {
    const list = qs("#snapshot-list");
    if (!list) return;
    clear(list);
    snapshotsCache.forEach((snap) => {
      const isDefault = snap.id === defaultSnapshotId;
      const defaultLabel = isDefault ? ` • ${t("admin.default")}` : "";
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${snap.id}${defaultLabel}` }),
        el("div", { class: "muted", text: `${snap.status || ""} • ${snap.createdAt || ""}` }),
      ]);
      row.addEventListener("click", async () => {
        currentSnapshotId = snap.id;
        await loadSnapshotDetail(snap.id);
      });
      list.appendChild(row);
    });
  };
  const loadSnapshotDetail = async (snapshotId) => {
    if (!snapshotId) return;
    const res = await apiGet(`/v1/admin/snapshots/${encodeURIComponent(snapshotId)}`);
    if (snapshotDetail) snapshotDetail.textContent = JSON.stringify(res.snapshot || {}, null, 2);
    currentSnapshotId = snapshotId;
  };
  const loadSnapshots = async () => {
    const res = await apiGet("/v1/admin/snapshots");
    snapshotsCache = res.snapshots || [];
    defaultSnapshotId = res.defaultSnapshotId || null;
    renderSnapshotList();
    const fromSelect = qs("#snapshot-diff-from");
    const toSelect = qs("#snapshot-diff-to");
    fillSnapshotSelect(fromSelect, snapshotsCache, snapshotsCache[0]?.id || "");
    fillSnapshotSelect(toSelect, snapshotsCache, snapshotsCache[1]?.id || snapshotsCache[0]?.id || "");
    if (currentSnapshotId) {
      await loadSnapshotDetail(currentSnapshotId);
    } else if (snapshotsCache[0]) {
      await loadSnapshotDetail(snapshotsCache[0].id);
    }
  };
  const createSnapshot = async () => {
    const note = qs("#snapshot-note")?.value?.trim() || null;
    const res = await apiPost("/v1/admin/snapshots/create", { note });
    setSnapshotStatus("admin.snapshotCreated");
    currentSnapshotId = res.snapshot?.id || null;
    await loadSnapshots();
  };
  const releaseSnapshot = async () => {
    if (!currentSnapshotId) return;
    try {
      await apiPost(`/v1/admin/snapshots/${encodeURIComponent(currentSnapshotId)}/release`, {});
      setSnapshotStatus("admin.snapshotReleased");
      await loadSnapshots();
    } catch (err) {
      const details = getErrorDetails(err);
      if (snapshotDetail) snapshotDetail.textContent = JSON.stringify(details || {}, null, 2);
      setSnapshotStatus("admin.snapshotReleaseFailed");
    }
  };
  const rollbackSnapshot = async () => {
    if (!currentSnapshotId) return;
    const targetId = qs("#snapshot-rollback-id")?.value?.trim();
    const payload = targetId ? { snapshotId: targetId } : {};
    try {
      await apiPost(`/v1/admin/snapshots/${encodeURIComponent(currentSnapshotId)}/rollback`, payload);
      setSnapshotStatus("admin.snapshotRolledBack");
      await loadSnapshots();
    } catch (err) {
      const details = getErrorDetails(err);
      if (snapshotDetail) snapshotDetail.textContent = JSON.stringify(details || {}, null, 2);
      setSnapshotStatus("admin.snapshotRollbackFailed");
    }
  };
  const runSnapshotDiff = async () => {
    const fromId = qs("#snapshot-diff-from")?.value;
    const toId = qs("#snapshot-diff-to")?.value;
    if (!fromId || !toId) return;
    const res = await apiGet(`/v1/admin/snapshots/diff?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`);
    if (snapshotDiffOutput) snapshotDiffOutput.textContent = JSON.stringify(res.diff || {}, null, 2);
  };
  const repinSnapshot = async () => {
    const targetUserId = qs("#snapshot-repin-user")?.value?.trim();
    const snapshotId = qs("#snapshot-repin-id")?.value?.trim();
    const reason = qs("#snapshot-repin-reason")?.value?.trim();
    if (!targetUserId || !snapshotId) return;
    const res = await apiPost(`/v1/admin/users/${encodeURIComponent(targetUserId)}/repin-snapshot`, {
      snapshotId,
      reason,
    });
    if (snapshotRepinOutput) snapshotRepinOutput.textContent = JSON.stringify(res || {}, null, 2);
  };

  let supportUserId = null;
  const renderSupportResult = (user) => {
    const list = qs("#support-result");
    if (!list) return;
    clear(list);
    supportUserId = user?.userId || null;
    if (!user) {
      list.appendChild(el("div", { class: "list-item muted", text: t("admin.noUser") }));
      return;
    }
    list.appendChild(
      el("div", { class: "list-item" }, [
        el("div", { text: `${user.email || ""} • ${user.userId}` }),
        el("div", { class: "muted", text: `${user.packId || ""} • ${user.lastSeenAt || ""}` }),
      ])
    );
  };

  const searchSupportUser = async () => {
    const email = qs("#support-email")?.value?.trim();
    if (!email) {
      renderSupportResult(null);
      return;
    }
    const res = await apiGet(`/v1/admin/users/search?email=${encodeURIComponent(email)}`);
    renderSupportResult(res.user || null);
  };

  const loadSupportBundle = async (bundleIdOverride = null) => {
    const bundleId = bundleIdOverride || qs("#support-bundle-id")?.value?.trim();
    if (!bundleId) return;
    const res = await apiGet(`/v1/admin/debug-bundles/${encodeURIComponent(bundleId)}`);
    if (qs("#support-output")) qs("#support-output").textContent = JSON.stringify(res.bundle || {}, null, 2);
  };

  const createSupportDebugBundle = async () => {
    if (!supportUserId) return;
    const res = await apiPost(`/v1/admin/users/${encodeURIComponent(supportUserId)}/debug-bundle`, {});
    if (qs("#support-bundle-id")) qs("#support-bundle-id").value = res.bundleId || "";
    await loadSupportBundle(res.bundleId);
  };

  const replaySupportSandbox = async () => {
    if (!supportUserId) return;
    const res = await apiPost(`/v1/admin/users/${encodeURIComponent(supportUserId)}/replay-sandbox`, {});
    if (qs("#support-output")) qs("#support-output").textContent = JSON.stringify(res, null, 2);
  };

  const replaySupportSnapshot = async () => {
    if (!supportUserId) return;
    const snapshotId = qs("#support-replay-snapshot")?.value?.trim();
    const limit = Number(qs("#support-replay-limit")?.value || 30);
    if (!snapshotId) return;
    const res = await apiPost("/v1/admin/support/replay", {
      userId: supportUserId,
      snapshotId,
      limit,
    });
    if (qs("#support-output")) qs("#support-output").textContent = JSON.stringify(res, null, 2);
    if (res?.replay?.bundleId && qs("#support-bundle-id")) {
      qs("#support-bundle-id").value = res.replay.bundleId;
    }
  };

  const loadCommunityPending = async () => {
    const res = await apiGet("/v1/admin/community/pending?page=1&pageSize=50");
    const list = qs("#community-pending-list");
    if (!list) return;
    clear(list);
    (res.items || []).forEach((item) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${item.resetItemId} • ${item.id}` }),
        el("div", { class: "muted", text: item.text }),
      ]);
      const approve = el("button", { class: "ghost", text: t("admin.approve") });
      approve.addEventListener("click", async () => {
        await apiPost(`/v1/admin/community/${encodeURIComponent(item.id)}/approve`, {});
        loadCommunityPending();
      });
      const reject = el("button", { class: "ghost", text: t("admin.reject") });
      reject.addEventListener("click", async () => {
        await apiPost(`/v1/admin/community/${encodeURIComponent(item.id)}/reject`, {});
        loadCommunityPending();
      });
      row.appendChild(approve);
      row.appendChild(reject);
      list.appendChild(row);
    });
  };

  const loadChangelog = async () => {
    const res = await apiGet("/v1/admin/changelog?page=1&pageSize=20");
    const list = qs("#changelog-list");
    if (!list) return;
    clear(list);
    (res.items || []).forEach((item) => {
      list.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { text: `${item.version} • ${item.title}` }),
          el("div", { class: "muted", text: `${item.audience} • ${item.createdAt}` }),
          el("div", { text: item.notes }),
        ])
      );
    });
  };

  const createChangelog = async () => {
    const version = qs("#changelog-version")?.value?.trim();
    const title = qs("#changelog-title")?.value?.trim();
    const notes = qs("#changelog-notes")?.value?.trim();
    const audience = qs("#changelog-audience")?.value || "admin";
    if (!version || !title || !notes) return;
    await apiPost("/v1/admin/changelog", { version, title, notes, audience });
    await loadChangelog();
  };

  const loadCohorts = async () => {
    const res = await apiGet("/v1/admin/cohorts");
    const list = qs("#cohorts-list");
    clear(list);
    (res.cohorts || []).forEach((cohort) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${cohort.id} • ${cohort.name || ""}` }),
      ]);
      const btn = el("button", { text: t("admin.parameters"), class: "ghost" });
      btn.addEventListener("click", async () => {
        const params = await apiGet(`/v1/admin/cohorts/${cohort.id}/parameters`);
        const block = el("div", { class: "list-item" }, [
          el("div", { text: `${t("admin.paramsFor")} ${cohort.id}` }),
        ]);
        (params.parameters || []).forEach((entry) => {
          const textarea = el("textarea", { rows: 4 }, []);
          textarea.value = JSON.stringify(entry.value, null, 2);
          const saveBtn = el("button", { text: t("admin.save"), class: "ghost" });
          saveBtn.addEventListener("click", async () => {
            await apiPatch(`/v1/admin/cohorts/${cohort.id}/parameters`, { key: entry.key, value_json: textarea.value });
          });
          block.appendChild(el("div", { text: entry.key }));
          block.appendChild(textarea);
          block.appendChild(saveBtn);
        });
        list.appendChild(block);
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  };

  const assignCohort = async () => {
    const userId = qs("#cohort-user-id")?.value?.trim();
    const cohortId = qs("#cohort-id")?.value?.trim();
    if (!userId || !cohortId) return;
    await apiPatch(`/v1/admin/users/${userId}/cohort`, { cohortId, overridden: true });
  };

  const loadAdminReminders = async () => {
    const dateISO = qs("#admin-reminders-date")?.value;
    const status = qs("#admin-reminders-status")?.value || "";
    const params = new URLSearchParams();
    if (dateISO) params.set("date", dateISO);
    if (status) params.set("status", status);
    params.set("page", "1");
    params.set("pageSize", "100");
    const res = await apiGet(`/v1/admin/reminders?${params.toString()}`);
    const list = qs("#admin-reminders-list");
    clear(list);
    (res.items || []).forEach((item) => {
      list.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { text: `${item.userId} • ${item.intentKey}` }),
          el("div", { class: "muted", text: `${item.status} • ${item.scheduledForISO}` }),
        ])
      );
    });
  };

  const bindButtons = () => {
    qs("#admin-content-load")?.addEventListener("click", loadContentList);
    qs("#content-save")?.addEventListener("click", saveEditor);
    qs("#content-disable")?.addEventListener("click", disableItem);
    qs("#sc-load")?.addEventListener("click", scLoadList);
    qs("#sc-kind")?.addEventListener("change", () => {
      scCurrent = null;
      scLoadList();
    });
    qs("#sc-status")?.addEventListener("change", scLoadList);
    qs("#sc-save-draft")?.addEventListener("click", scSaveDraft);
    qs("#sc-stage")?.addEventListener("click", scStage);
    qs("#sc-enable")?.addEventListener("click", scEnable);
    qs("#sc-disable")?.addEventListener("click", scDisable);
    qs("#sc-validate")?.addEventListener("click", scValidate);
    qs("#sc-reports-load")?.addEventListener("click", scLoadReports);
    qs("#worst-load")?.addEventListener("click", loadWorst);
    qs("#heatmap-load")?.addEventListener("click", loadHeatmap);
    qs("#packs-load")?.addEventListener("click", () => loadPackDetail(qs("#packs-select")?.value));
    qs("#packs-save")?.addEventListener("click", savePack);
    qs("#packs-select")?.addEventListener("change", (e) => loadPackDetail(e.target.value));
    qs("#experiments-load")?.addEventListener("click", loadExperiments);
    qs("#exp-create")?.addEventListener("click", createExperiment);
    qs("#exp-assign-load")?.addEventListener("click", () => loadExperimentAssignments());
    qs("#matrix-run")?.addEventListener("click", runPreviewMatrix);
    qs("#cohorts-load")?.addEventListener("click", loadCohorts);
    qs("#cohort-assign")?.addEventListener("click", assignCohort);
    qs("#admin-reminders-load")?.addEventListener("click", loadAdminReminders);
    qs("#weekly-load")?.addEventListener("click", loadWeeklyReport);
    qs("#weekly-download")?.addEventListener("click", downloadWeeklyReport);
    qs("#weekly-disable-all")?.addEventListener("click", disableWeeklyCandidates);
    qs("#weekly-bump")?.addEventListener("click", bumpWeeklyPriority);
    qs("#outline-preview")?.addEventListener("click", previewOutline);
    qs("#outline-save")?.addEventListener("click", saveOutlineDraft);
    qs("#validator-load")?.addEventListener("click", loadValidatorLatest);
    qs("#validator-run")?.addEventListener("click", runValidatorNow);
    qs("#ops-refresh")?.addEventListener("click", loadOpsDashboard);
    qs("#snapshot-load")?.addEventListener("click", loadSnapshots);
    qs("#snapshot-create")?.addEventListener("click", createSnapshot);
    qs("#snapshot-release")?.addEventListener("click", releaseSnapshot);
    qs("#snapshot-rollback")?.addEventListener("click", rollbackSnapshot);
    qs("#snapshot-diff-run")?.addEventListener("click", runSnapshotDiff);
    qs("#snapshot-repin")?.addEventListener("click", repinSnapshot);
    qs("#support-search")?.addEventListener("click", searchSupportUser);
    qs("#support-debug-bundle")?.addEventListener("click", createSupportDebugBundle);
    qs("#support-replay")?.addEventListener("click", replaySupportSandbox);
    qs("#support-replay-snapshot-btn")?.addEventListener("click", replaySupportSnapshot);
    qs("#support-bundle-load")?.addEventListener("click", () => loadSupportBundle());
    qs("#community-pending-load")?.addEventListener("click", loadCommunityPending);
    qs("#changelog-create")?.addEventListener("click", createChangelog);
    qs("#changelog-load")?.addEventListener("click", loadChangelog);
  };

  checkAdmin().then((ok) => {
    if (!ok) return;
    initTabs();
    bindButtons();
    loadContentList();
    scLoadList();
    scLoadReports();
    loadWorst();
    loadHeatmap();
    loadParameters();
    loadPacksList();
    loadExperiments();
    runPreviewMatrix();
    loadOpsDashboard();
    loadSnapshots();
    const adminRemindersDate = qs("#admin-reminders-date");
    if (adminRemindersDate) adminRemindersDate.value = todayISO();
    loadCohorts();
    loadAdminReminders();
    loadWeeklyReport();
    loadChangelog();
    loadValidatorLatest();
    loadCommunityPending();
  });
}

function shouldAutoBoot() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    const anyVisible = document.querySelector("[data-step]:not(.hidden)");
    if (!anyVisible) {
      console.warn("[SAFETY] No step visible, forcing entry");
      let hasProfile = false;
      try {
        const cached = localStorage.getItem("livenew_profile");
        if (cached) {
          const p = JSON.parse(cached);
          if (p && p.goal) hasProfile = true;
        }
      } catch {}

      if (hasProfile) {
        if (isTrialExpired()) showStep("paywall");
        else showStep("stress-tap");
      } else {
        showStep("onboard");
        showOnboardStep("intro");
      }
    }
  }, 2000);
});

// Legacy auto-boot disabled — bootstrapApp (called from app.init.js) is the sole entry point.
// if (typeof init === "function" && shouldAutoBoot()) {
//   init().catch((err) => console.error(err));
// }

export {
  initDay,
  initWeek,
  initTrends,
  initProfile,
  t,
};
