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
} from "./app.api.202602082317-60c1044.js";
import { getAppState as getAppStateInternal, setAppState } from "./app.state.202602082317-60c1044.js";
import { qs, qsa, el, clear, setText, formatMinutes, formatPct, applyI18n, getDictValue } from "./app.ui.202602082317-60c1044.js";
import { STRINGS as EN_STRINGS } from "../i18n/en.js";
/* REQUIRED: build-time export used by controllers + asset verification */
export function getAppState() {
  try {
    if (typeof window !== "undefined" && window.__LN_STATE__) return window.__LN_STATE__;
  } catch {}
  return {};
}
void getAppStateInternal;
export const BUILD_ID = "202602082317-60c1044";

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
  const status = qs("#onboard-status");
  if (status) status.textContent = "";
  if (qs("#onboard-timezone")) qs("#onboard-timezone").value = defaults.timezone || "America/Los_Angeles";
  if (qs("#onboard-boundary")) qs("#onboard-boundary").value = String(defaults.dayBoundaryHour ?? 0);
  if (qs("#onboard-stress")) qs("#onboard-stress").value = defaults.stress || "5";
  if (qs("#onboard-sleep")) qs("#onboard-sleep").value = defaults.sleepQuality || "6";
  if (qs("#onboard-energy")) qs("#onboard-energy").value = defaults.energy || "6";
  onboardStep = 0;
  updateOnboardWizard();
  if (!onboardBound) {
    const backBtn = qs("#onboard-back");
    const nextBtn = qs("#onboard-next");
    const submit = qs("#onboard-submit");
    backBtn?.addEventListener("click", () => setOnboardStep(onboardStep - 1));
    nextBtn?.addEventListener("click", () => {
      if (!onboardStepValid(onboardStep)) return;
      setOnboardStep(onboardStep + 1);
    });
    [
      "#onboard-timezone",
      "#onboard-boundary",
      "#onboard-stress",
      "#onboard-sleep",
      "#onboard-energy",
      "#onboard-time",
      "#onboard-consent-terms",
      "#onboard-consent-privacy",
      "#onboard-consent-alpha",
    ].forEach((selector) => {
      const el = qs(selector);
      el?.addEventListener("input", updateOnboardWizard);
      el?.addEventListener("change", updateOnboardWizard);
    });
    submit?.addEventListener("click", async () => {
      if (status) status.textContent = t("onboard.saving");
      const consent = {
        terms: Boolean(qs("#onboard-consent-terms")?.checked),
        privacy: Boolean(qs("#onboard-consent-privacy")?.checked),
        alphaProcessing: Boolean(qs("#onboard-consent-alpha")?.checked),
      };
      if (!consent.terms || !consent.privacy || !consent.alphaProcessing) {
        if (status) status.textContent = t("consent.missing");
        return;
      }
      const baseline = {
        timezone: qs("#onboard-timezone")?.value?.trim() || undefined,
        dayBoundaryHour: Number(qs("#onboard-boundary")?.value || 0),
        constraints: {
          injuries: {
            knee: Boolean(qs("#onboard-injury-knee")?.checked),
            shoulder: Boolean(qs("#onboard-injury-shoulder")?.checked),
            back: Boolean(qs("#onboard-injury-back")?.checked),
          },
          equipment: {
            none: Boolean(qs("#onboard-eq-none")?.checked),
            dumbbells: Boolean(qs("#onboard-eq-dumbbells")?.checked),
            bands: Boolean(qs("#onboard-eq-bands")?.checked),
            gym: Boolean(qs("#onboard-eq-gym")?.checked),
          },
          timeOfDayPreference: qs("#onboard-time-pref")?.value || "any",
        },
      };
      const firstCheckIn = {
        stress: Number(qs("#onboard-stress")?.value || 5),
        sleepQuality: Number(qs("#onboard-sleep")?.value || 6),
        energy: Number(qs("#onboard-energy")?.value || 6),
        timeAvailableMin: Number(qs("#onboard-time")?.value || 20),
      };
      try {
        const res = await apiPost("/v1/onboard/complete", { consent, baseline, firstCheckIn });
        if (status) status.textContent = "";
        hideGateCard(card);
        if (typeof onboardHandlers.onComplete === "function") {
          await onboardHandlers.onComplete(res);
        }
      } catch (err) {
        if (status) status.textContent = t("onboard.failed");
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
    controllersModule = import("./controllers.202602082317-60c1044.js");
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
    if (code === "auth_required" || code === "consent_required" || code === "consent_required_version") {
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
  if (protectedPages.has(resolvedPage) && !hasValidToken(getToken())) {
    window.location.assign("/login.html");
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
    if (routeError) routeError(err);
    else reportError(err);
  } finally {
    initInFlight = false;
    if (pendingInit) {
      pendingInit = false;
      void bootstrapApp({ page: resolvedPage });
    }
  }
}

function renderDay(contract) {
  if (!contract) return null;
  const resetMinutes = contract.reset?.seconds ? Math.max(1, Math.round(contract.reset.seconds / 60)) : 2;
  const titleEl = qs("#today-reco-title");
  const bodyEl = qs("#today-reco-body");
  const stepsEl = qs("#today-reco-steps");
  if (titleEl) titleEl.textContent = contract.reset?.title || "Two-minute reset";
  if (bodyEl) {
    bodyEl.textContent = `${contract.reset?.title || "Reset"} for about ${resetMinutes} min. Keep it gentle.`;
  }
  if (stepsEl) {
    const steps = Array.isArray(contract.reset?.steps) ? contract.reset.steps : [];
    stepsEl.textContent = steps.length ? steps.join(" • ") : "Breathe slowly and release shoulder tension.";
  }
  return contract;
}

function initDay({ initialDateISO } = {}) {
  console.log("[day] initDay running");
  const dayRoot = qs("#today-flow");
  if (!dayRoot) return;
  const introPanel = qs("#day-intro");
  const onboardingRoot = qs("#onboarding");
  const dayApp = qs("#day-app");
  const beginBtn = document.getElementById("begin-personalization");

  const stepNodes = Array.from(dayRoot.querySelectorAll("[data-step]"));
  const stepNames = new Set(stepNodes.map((node) => node.dataset.step).filter(Boolean));
  const secondaryNav = qs("#day-secondary-nav");
  const stepIndicator = qs("#today-step-indicator");
  const statusEl = qs("#today-status");
  const beginResetBtn = qs("#today-begin-reset");
  const doneLinks = qs("#today-done-links");
  const choice = { stress: null, energy: null, time: null };
  let currentContract = null;
  let currentDateISO = initialDateISO || todayISO();

  const showStep = (name) => {
    if (!stepNames.has(name)) return;
    stepNodes.forEach((node) => node.classList.toggle("hidden", node.dataset.step !== name));
    if (secondaryNav) secondaryNav.classList.toggle("hidden", name !== "done");
    if (stepIndicator) {
      const order = ["stress", "energy", "time", "reco"];
      const idx = order.indexOf(name);
      stepIndicator.textContent = idx >= 0 ? `Step ${idx + 1} of ${order.length}` : "Complete";
    }
  };

  const setVisible = (node, visible) => {
    if (!node) return;
    node.classList.toggle("hidden", !visible);
    node.setAttribute("aria-hidden", visible ? "false" : "true");
  };

  const onboardingQuestions = [
    { key: "goal", prompt: "What feels most important right now?", options: ["Calm", "Focus", "Energy", "Recovery"] },
    { key: "stress", prompt: "How stressed do you feel?", options: ["Low", "Medium", "High"] },
    { key: "energy", prompt: "How is your energy level?", options: ["Low", "Steady", "High"] },
    { key: "time", prompt: "How much time do you have?", options: ["5 min", "10 min", "20 min"] },
    { key: "style", prompt: "What pace should we use?", options: ["Very gentle", "Balanced", "Challenge me"] },
  ];
  const onboardingAnswers = {};
  let onboardingIndex = 0;

  const showDayApp = () => {
    setVisible(introPanel, false);
    setVisible(onboardingRoot, false);
    setVisible(dayApp, true);
    showStep("stress");
  };

  const finishOnboarding = () => {
    localStorage.setItem("ln_onboarding_done", "1");
    showDayApp();
  };

  const renderOnboardingStep = () => {
    if (!onboardingRoot) return;
    const question = onboardingQuestions[onboardingIndex];
    if (!question) {
      finishOnboarding();
      return;
    }
    onboardingRoot.innerHTML = "";
    const progress = document.createElement("div");
    progress.className = "today-progress";
    progress.textContent = `${onboardingIndex + 1} of ${onboardingQuestions.length}`;
    const title = document.createElement("h2");
    title.className = "today-question";
    title.textContent = question.prompt;
    const options = document.createElement("div");
    options.className = "choice-grid";
    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "primary today-next";
    continueBtn.textContent = onboardingIndex === onboardingQuestions.length - 1 ? "Finish" : "Continue";
    continueBtn.disabled = !onboardingAnswers[question.key];

    question.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.value = option;
      btn.textContent = option;
      if (onboardingAnswers[question.key] === option) btn.classList.add("active");
      btn.addEventListener("click", () => {
        onboardingAnswers[question.key] = option;
        Array.from(options.querySelectorAll("button")).forEach((node) => {
          node.classList.toggle("active", node === btn);
        });
        continueBtn.disabled = false;
      });
      options.appendChild(btn);
    });

    continueBtn.addEventListener("click", () => {
      if (!onboardingAnswers[question.key]) return;
      onboardingIndex += 1;
      renderOnboardingStep();
    });

    onboardingRoot.appendChild(progress);
    onboardingRoot.appendChild(title);
    onboardingRoot.appendChild(options);
    onboardingRoot.appendChild(continueBtn);
  };

  const startOnboarding = (event) => {
    event?.preventDefault?.();
    if (window.location.search.includes("debug=1")) console.log("onboarding:start");
    onboardingIndex = 0;
    setVisible(introPanel, false);
    setVisible(dayApp, false);
    setVisible(onboardingRoot, true);
    renderOnboardingStep();
  };

  beginBtn?.addEventListener("click", startOnboarding);

  const bindChoiceButtons = (containerId, key) => {
    const container = qs(containerId);
    const buttons = container ? Array.from(container.querySelectorAll("button[data-value]")) : [];
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        choice[key] = Number(btn.dataset.value);
        buttons.forEach((other) => other.classList.toggle("active", other === btn));
      });
    });
  };

  bindChoiceButtons("#today-stress-options", "stress");
  bindChoiceButtons("#today-energy-options", "energy");
  bindChoiceButtons("#today-time-options", "time");
  qs("#today-stress-next")?.addEventListener("click", () => {
    if (!isNumberInRange(choice.stress, 1, 10)) return;
    showStep("energy");
  });
  qs("#today-energy-next")?.addEventListener("click", () => {
    if (!isNumberInRange(choice.energy, 1, 10)) return;
    showStep("time");
  });
  qs("#today-time-next")?.addEventListener("click", async () => {
    if (![5, 10, 20].includes(Number(choice.time))) return;
    if (statusEl) statusEl.textContent = "Finding your best next step…";
    try {
      const checkIn = {
        dateISO: currentDateISO,
        stress: Number(choice.stress),
        sleepQuality: 6,
        energy: Number(choice.energy),
        timeAvailableMin: Number(choice.time),
      };
      const res = await apiPost("/v1/checkin", { checkIn });
      currentContract = renderDay(res);
      currentDateISO = res?.dateISO || currentDateISO;
      if (statusEl) statusEl.textContent = "";
      showStep("reco");
    } catch (err) {
      if (statusEl) statusEl.textContent = "Could not load recommendation. Try again.";
      reportError(err);
    }
  });

  beginResetBtn?.addEventListener("click", async () => {
    if (statusEl) statusEl.textContent = "Saving completion…";
    try {
      if (currentContract?.reset?.id) {
        await apiPost("/v1/reset/complete", {
          dateISO: currentContract.dateISO || currentDateISO,
          resetId: currentContract.reset.id,
        });
      }
      if (doneLinks) doneLinks.classList.remove("hidden");
      if (statusEl) statusEl.textContent = "";
      showStep("done");
    } catch (err) {
      if (statusEl) statusEl.textContent = "Could not save completion. You can continue anyway.";
      reportError(err);
      showStep("done");
    }
  });

  const onboardingDone = localStorage.getItem("ln_onboarding_done") === "1";
  if (onboardingDone) {
    showDayApp();
  } else {
    setVisible(introPanel, true);
    setVisible(onboardingRoot, false);
    setVisible(dayApp, false);
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
      reportError(err);
    }
  };

  loadBtn?.addEventListener("click", () => {
    loadTrends();
  });
  loadTrends();
}

function initProfile() {
  const saveBtn = qs("#profile-save");
  const constraintsSave = qs("#constraints-save");
  const communityOptSave = qs("#community-opt-save");
  const hardResetBtn = qs("#hard-reset");
  const sessionsList = qs("#sessions-list");
  const deviceInput = qs("#device-name");
  const deviceSave = qs("#device-name-save");
  const privacySave = qs("#privacy-save");
  const privacyStatus = qs("#privacy-status");
  const remindersDate = qs("#reminders-date");
  const remindersLoad = qs("#reminders-load");
  const remindersList = qs("#reminders-list");
  const changesDate = qs("#changes-date");
  const changesLoad = qs("#changes-load");
  const changesList = qs("#changes-list");
  const changelogLoad = qs("#profile-changelog-load");
  const changelogList = qs("#profile-changelog-list");
  const appState = getAppState();

  if (hardResetBtn) {
    const allowHardReset =
      appState.envMode === "dev" ||
      appState.envMode === "internal" ||
      appState.auth?.isAdmin === true;
    hardResetBtn.classList.toggle("hidden", !allowHardReset);
    hardResetBtn.addEventListener("click", async () => {
      try {
        await logoutAuth();
      } catch {
        // ignore
      }
      clearTokens();
      window.location.href = "/";
    });
  }

  const loadProfile = async () => {
    try {
      const res = await apiGet("/v1/account/export");
      const profile = res.export?.userProfile || {};
      qs("#profile-wake").value = profile.wakeTime || "07:00";
      qs("#profile-bed").value = profile.bedTime || "23:00";
      qs("#profile-sleep-regular").value = profile.sleepRegularity || 5;
      qs("#profile-caffeine").value = profile.caffeineCupsPerDay || 1;
      qs("#profile-late-caffeine").value = profile.lateCaffeineDaysPerWeek || 1;
      qs("#profile-sunlight").value = profile.sunlightMinutesPerDay || 10;
      qs("#profile-screen").value = profile.lateScreenMinutesPerNight || 45;
      qs("#profile-alcohol").value = profile.alcoholNightsPerWeek || 1;
      qs("#profile-meal").value = profile.mealTimingConsistency || 5;
      if (qs("#profile-timezone")) qs("#profile-timezone").value = profile.timezone || "America/Los_Angeles";
      qs("#profile-pack").value = profile.contentPack || "balanced_routine";
      if (qs("#privacy-enabled")) qs("#privacy-enabled").checked = Boolean(profile.dataMinimization?.enabled);
      if (qs("#privacy-store-notes")) qs("#privacy-store-notes").checked = profile.dataMinimization?.storeNotes !== false;
      if (qs("#privacy-store-traces")) qs("#privacy-store-traces").checked = profile.dataMinimization?.storeTraces !== false;
      if (qs("#privacy-event-days")) qs("#privacy-event-days").value = profile.dataMinimization?.eventRetentionDays || 90;
      if (qs("#privacy-history-days")) qs("#privacy-history-days").value = profile.dataMinimization?.historyRetentionDays || 90;
      const constraints = profile.constraints || {};
      const injuries = constraints.injuries || {};
      const equipment = constraints.equipment || {};
      if (qs("#constraint-injury-knee")) qs("#constraint-injury-knee").checked = Boolean(injuries.knee);
      if (qs("#constraint-injury-shoulder")) qs("#constraint-injury-shoulder").checked = Boolean(injuries.shoulder);
      if (qs("#constraint-injury-back")) qs("#constraint-injury-back").checked = Boolean(injuries.back);
      if (qs("#constraint-eq-none")) qs("#constraint-eq-none").checked = equipment.none !== false;
      if (qs("#constraint-eq-dumbbells")) qs("#constraint-eq-dumbbells").checked = Boolean(equipment.dumbbells);
      if (qs("#constraint-eq-bands")) qs("#constraint-eq-bands").checked = Boolean(equipment.bands);
      if (qs("#constraint-eq-gym")) qs("#constraint-eq-gym").checked = Boolean(equipment.gym);
      if (qs("#constraint-time-pref")) {
        qs("#constraint-time-pref").value = constraints.timeOfDayPreference || "any";
      }
      try {
        const community = await apiGet("/v1/community/opt-in");
        if (qs("#community-opt-in")) qs("#community-opt-in").checked = Boolean(community.optedIn);
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const loadSessions = async () => {
    if (!getToken() && !getRefreshToken()) return;
    const res = await apiGet("/v1/account/sessions");
    clear(sessionsList);
    (res.sessions || []).forEach((session) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: session.deviceName || t("misc.unnamedDevice") }),
        el("div", { class: "muted", text: `${t("misc.lastSeen")}: ${session.lastSeenAt || session.createdAt}` }),
      ]);
      if (!session.isCurrent) {
        const btn = el("button", { text: t("misc.revoke"), class: "ghost" });
        btn.addEventListener("click", async () => {
          await apiPost("/v1/account/sessions/revoke", { token: session.token });
          loadSessions();
        });
        row.appendChild(btn);
      } else {
        row.appendChild(el("div", { class: "muted", text: t("misc.currentSession") }));
      }
      sessionsList.appendChild(row);
    });
  };

  const buildProfileFromForm = () => ({
    wakeTime: qs("#profile-wake").value,
    bedTime: qs("#profile-bed").value,
    sleepRegularity: Number(qs("#profile-sleep-regular").value),
    caffeineCupsPerDay: Number(qs("#profile-caffeine").value),
    lateCaffeineDaysPerWeek: Number(qs("#profile-late-caffeine").value),
    sunlightMinutesPerDay: Number(qs("#profile-sunlight").value),
    lateScreenMinutesPerNight: Number(qs("#profile-screen").value),
    alcoholNightsPerWeek: Number(qs("#profile-alcohol").value),
    mealTimingConsistency: Number(qs("#profile-meal").value),
    contentPack: qs("#profile-pack").value,
    timezone: qs("#profile-timezone")?.value?.trim() || "America/Los_Angeles",
    constraints: {
      injuries: {
        knee: Boolean(qs("#constraint-injury-knee")?.checked),
        shoulder: Boolean(qs("#constraint-injury-shoulder")?.checked),
        back: Boolean(qs("#constraint-injury-back")?.checked),
      },
      equipment: {
        none: Boolean(qs("#constraint-eq-none")?.checked),
        dumbbells: Boolean(qs("#constraint-eq-dumbbells")?.checked),
        bands: Boolean(qs("#constraint-eq-bands")?.checked),
        gym: Boolean(qs("#constraint-eq-gym")?.checked),
      },
      timeOfDayPreference: qs("#constraint-time-pref")?.value || "any",
    },
  });

  saveBtn?.addEventListener("click", async () => {
    const userProfile = buildProfileFromForm();
    await apiPost("/v1/profile", { userProfile });
  });

  constraintsSave?.addEventListener("click", async () => {
    const userProfile = buildProfileFromForm();
    await apiPost("/v1/profile", { userProfile });
  });

  communityOptSave?.addEventListener("click", async () => {
    const optedIn = Boolean(qs("#community-opt-in")?.checked);
    await apiPost("/v1/community/opt-in", { optedIn });
  });

  privacySave?.addEventListener("click", async () => {
    const dataMinimization = {
      enabled: Boolean(qs("#privacy-enabled")?.checked),
      storeNotes: Boolean(qs("#privacy-store-notes")?.checked),
      storeTraces: Boolean(qs("#privacy-store-traces")?.checked),
      eventRetentionDays: Number(qs("#privacy-event-days")?.value || 90),
      historyRetentionDays: Number(qs("#privacy-history-days")?.value || 90),
    };
    await apiPatch("/v1/account/privacy", { dataMinimization });
    if (privacyStatus) privacyStatus.textContent = t("misc.saved");
  });

  const loadReminders = async () => {
    if (!remindersDate?.value) return;
    const res = await apiGet(`/v1/reminders?date=${remindersDate.value}`);
    clear(remindersList);
    (res.items || []).forEach((item) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: `${item.intentKey} • ${item.status}` }),
        el("div", { class: "muted", text: item.scheduledForISO }),
      ]);
      if (item.status === "scheduled") {
        const dismissBtn = el("button", { text: "Dismiss", class: "ghost" });
        dismissBtn.addEventListener("click", async () => {
          await apiPost(`/v1/reminders/${item.id}/dismiss`, {});
          loadReminders();
        });
        const completeBtn = el("button", { text: "Complete", class: "ghost" });
        completeBtn.addEventListener("click", async () => {
          await apiPost(`/v1/reminders/${item.id}/complete`, {});
          loadReminders();
        });
        row.appendChild(dismissBtn);
        row.appendChild(completeBtn);
      }
      remindersList.appendChild(row);
    });
  };

  remindersLoad?.addEventListener("click", loadReminders);
  if (remindersDate) remindersDate.value = todayISO();

  const loadChanges = async () => {
    if (!changesDate?.value) return;
    try {
      const res = await apiGet(`/v1/plan/changes?date=${changesDate.value}`);
      clear(changesList);
      (res.items || []).forEach((item) => {
        const row = el("div", { class: "list-item" }, [
          el("div", { text: item.summary?.short || t("misc.planUpdated") }),
          el("div", { class: "muted", text: item.createdAt }),
        ]);
        changesList.appendChild(row);
      });
    } catch (err) {
      reportError(err);
    }
  };

  changesLoad?.addEventListener("click", loadChanges);
  if (changesDate) changesDate.value = todayISO();

  const loadUserChangelog = async () => {
    const res = await apiGet("/v1/changelog?audience=user&limit=5");
    if (!changelogList) return;
    clear(changelogList);
    (res.items || []).forEach((item) => {
      changelogList.appendChild(
        el("div", { class: "list-item" }, [
          el("div", { text: `${item.version} • ${item.title}` }),
          el("div", { class: "muted", text: item.createdAt }),
          el("div", { text: item.notes }),
        ])
      );
    });
  };

  changelogLoad?.addEventListener("click", loadUserChangelog);

  deviceSave?.addEventListener("click", async () => {
    const name = deviceInput?.value?.trim();
    if (!name) return;
    setDeviceName(name);
    if (getToken() || getRefreshToken()) await apiPost("/v1/account/sessions/name", { deviceName: name });
    loadSessions();
  });

  if (getDeviceName() && deviceInput) deviceInput.value = getDeviceName();
  loadProfile();
  loadSessions();
  loadReminders();
  loadChanges();
  loadUserChangelog();
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

if (typeof init === "function" && shouldAutoBoot()) {
  init().catch((err) => console.error(err));
}

export {
  initDay,
  initWeek,
  initTrends,
  initProfile,
  t,
};
