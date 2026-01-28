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
import { qs, qsa, el, clear, setText, formatMinutes, formatPct, applyI18n, getDictValue } from "./app.ui.js";
import { STRINGS as EN_STRINGS } from "../i18n/en.js";

const LOCALE = "en";
const STRINGS = { en: EN_STRINGS }[LOCALE] || EN_STRINGS;

const t = (key, fallback = "") => getDictValue(STRINGS, key, fallback);
const SIGNALS = [
  { id: "im_stressed", label: t("signals.im_stressed") },
  { id: "im_exhausted", label: t("signals.im_exhausted") },
  { id: "i_have_10_min", label: t("signals.i_have_10_min") },
  { id: "i_have_more_energy", label: t("signals.i_have_more_energy") },
  { id: "poor_sleep", label: t("signals.poor_sleep") },
  { id: "anxious", label: t("signals.anxious") },
  { id: "wired", label: t("signals.wired") },
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

const DEFAULT_APP_STATE = {
  auth: { isAuthenticated: false, isAdmin: false },
  consentComplete: false,
  envMode: null,
  uiState: "login",
};

function getAppState() {
  return window.__APP_STATE || { ...DEFAULT_APP_STATE };
}

function setAppState(bootstrap) {
  const next = {
    ...DEFAULT_APP_STATE,
    ...(bootstrap || {}),
  };
  next.auth = { ...DEFAULT_APP_STATE.auth, ...(bootstrap?.auth || {}) };
  next.envMode = bootstrap?.env?.mode || bootstrap?.envMode || DEFAULT_APP_STATE.envMode;
  next.consentComplete = Boolean(bootstrap?.consent?.isComplete);
  next.uiState = bootstrap?.uiState || next.uiState;
  window.__APP_STATE = next;
  return next;
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

function showErrorScreen({ title, message, requestId }) {
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

function routeError(err, { consentGate } = {}) {
  const code = getErrorCode(err) || "unknown_error";
  if (code === "consent_required" || code === "consent_required_version") {
    if (consentGate?.show) {
      consentGate.show();
      return;
    }
    showErrorScreen({ title: t("error.consentTitle"), message: t("error.consentBody"), requestId: err?.requestId });
    return;
  }
  if (code === "auth_required") {
    showErrorScreen({ title: t("error.authTitle"), message: t("error.authBody"), requestId: err?.requestId });
    qs("#auth-email")?.focus();
    return;
  }
  if (code === "feature_disabled") {
    showErrorScreen({ title: t("error.featureTitle"), message: t("error.featureBody"), requestId: err?.requestId });
    return;
  }
  if (code === "incident_mode") {
    showErrorScreen({ title: t("error.incidentTitle"), message: t("error.incidentBody"), requestId: err?.requestId });
    return;
  }
  showErrorScreen({ title: t("error.genericTitle"), message: t("error.genericBody"), requestId: err?.requestId });
}

async function bootstrapApp() {
  try {
    const boot = await apiGet("/v1/bootstrap");
    return setAppState(boot);
  } catch (err) {
    routeError(err);
    return setAppState({});
  }
}

function setupConsentGate(onAccepted) {
  const card = qs("#consent-card");
  if (!card) return { show: () => false };
  const terms = qs("#consent-terms");
  const privacy = qs("#consent-privacy");
  const alpha = qs("#consent-alpha");
  const submit = qs("#consent-submit");
  const status = qs("#consent-status");
  let pending = false;
  submit?.addEventListener("click", async () => {
    if (pending) return;
    if (!terms?.checked || !privacy?.checked || !alpha?.checked) {
      if (status) status.textContent = t("consent.missing");
      return;
    }
    pending = true;
    if (status) status.textContent = t("consent.saving");
    try {
      await apiPost("/v1/consent/accept", {
        accept: { terms: true, privacy: true, alphaProcessing: true },
      });
      await bootstrapApp();
      card.classList.add("hidden");
      if (status) status.textContent = "";
      if (typeof onAccepted === "function") onAccepted();
    } catch {
      if (status) status.textContent = t("consent.failed");
    } finally {
      pending = false;
    }
  });
  return {
    show: () => {
      card.classList.remove("hidden");
      if (status) status.textContent = "";
      return true;
    },
  };
}

async function checkConsentStatus() {
  if (!getToken() && !getRefreshToken()) {
    return { ok: true, required: [], accepted: {} };
  }
  try {
    const res = await apiGet("/v1/consent/status");
    const required = Array.isArray(res.required) ? res.required : ["terms", "privacy", "alpha_processing"];
    const accepted = res.accepted || {};
    const requiredVersion = Number(res.requiredVersion || 0);
    const userVersion = Number(res.userVersion || 0);
    const ok = required.every((key) => accepted[key] === true) && userVersion >= requiredVersion;
    return { ok, required, accepted, requiredVersion, userVersion };
  } catch (err) {
    if (getErrorCode(err) === "auth_required") {
      return { ok: true, required: [], accepted: {} };
    }
    throw err;
  }
}

async function ensurePlanAccess(consentGate) {
  const state = getAppState();
  if (!state.auth?.isAuthenticated) {
    routeError({ code: "auth_required" });
    return false;
  }
  if (state.consentComplete) return true;
  try {
    const status = await checkConsentStatus();
    if (status.ok) {
      state.consentComplete = true;
      return true;
    }
    if (consentGate?.show) {
      consentGate.show();
    } else {
      routeError({ code: "consent_required" });
    }
    return false;
  } catch (err) {
    routeError(err, { consentGate });
    return false;
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
    admin: `${t("appName")} — ${t("nav.admin")}`,
  };
  if (page && titleMap[page]) {
    document.title = titleMap[page];
  }
}

function bindAuth() {
  const emailInput = qs("#auth-email");
  const codeInput = qs("#auth-code");
  const requestBtn = qs("#auth-request");
  const verifyBtn = qs("#auth-verify");
  const logoutBtn = qs("#auth-logout");

  updateAuthStatus();

  requestBtn?.addEventListener("click", async () => {
    const email = emailInput?.value?.trim();
    if (!email) return;
    await requestAuth(email);
    setText(qs("#auth-status"), t("auth.codeSent"));
  });

  verifyBtn?.addEventListener("click", async () => {
    const email = emailInput?.value?.trim();
    const code = codeInput?.value?.trim();
    if (!email || !code) return;
    const res = await verifyAuth(email, code);
    if (res?.accessToken || res?.token) {
      setToken(res.accessToken || res.token);
      if (res.refreshToken) setRefreshToken(res.refreshToken);
      updateAuthStatus();
      const boot = await bootstrapApp();
      setAppState(boot);
      await updateAdminVisibility();
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
    updateAdminVisibility();
    setAppState({});
  });
}

function updateAuthStatus() {
  const status = qs("#auth-status");
  if (!status) return;
  status.textContent = getToken() || getRefreshToken() ? t("auth.signedIn") : t("auth.notSignedIn");
}

async function updateAdminVisibility() {
  const adminLinks = qsa(".admin-link");
  adminLinks.forEach((link) => (link.style.display = "none"));
  if (!getToken() && !getRefreshToken()) return;
  try {
    const res = await apiGet("/v1/admin/me");
    if (res?.isAdmin) {
      adminLinks.forEach((link) => (link.style.display = "inline-flex"));
    }
  } catch {
    // ignore
  }
}

function renderDay(day) {
  setText(
    qs("#day-what"),
    `${t("labels.workout")}: ${day.what.workout?.title || "–"} (${day.what.workout?.minutes || "–"} min)\n` +
      `${t("labels.reset")}: ${day.what.reset.title || "–"} (${day.what.reset.minutes || "–"} min)\n` +
      `${t("labels.nutrition")}: ${day.what.nutrition.title || "–"}`
  );
  const whyEl = qs("#day-why");
  const short = day.why?.shortRationale || day.why?.statement || "";
  const whyNot = (day.why?.whyNot || []).join(" ");
  const reEntryMsg = day.why?.reEntry?.active ? `${t("labels.reEntry")}: ${day.why.reEntry.message}` : "";
  setText(
    whyEl,
    `${t("labels.profile")}: ${day.why.profile || "–"}\n` +
      `${t("labels.focus")}: ${day.why.focus || "–"}\n` +
      `${short}\n` +
      `${whyNot}${reEntryMsg ? `\n${reEntryMsg}` : ""}`
  );
  if (day.why?.safety?.level && day.why.safety.level !== "ok" && whyEl) {
    setText(
      whyEl,
      `${whyEl.textContent}\n${t("labels.safety")}: ${day.why.safety.level} (${(day.why.safety.reasons || []).join(", ")})`
    );
  }
  setText(
    qs("#day-howlong"),
    `${t("labels.total")}: ${formatMinutes(day.howLong.totalMinutes)}\n` +
      `${t("labels.available")}: ${day.howLong.timeAvailableMin || "–"} min`
  );

  const details = qs("#day-details");
  if (!details) return;
  clear(details);
  const workoutSteps = (day.details.workoutSteps || []).join(" • ") || "–";
  const resetSteps = (day.details.resetSteps || []).join(" • ") || "–";
  const nutrition = (day.details.nutritionPriorities || []).join(" • ") || "–";
  const anchors = day.details.anchors;
  const citationIds = Array.isArray(day.details.citations) ? day.details.citations : [];
  const anchorLines = [];
  if (anchors?.sunlightAnchor) anchorLines.push(`${t("labels.sunlight")}: ${anchors.sunlightAnchor.instruction}`);
  if (anchors?.mealTimingAnchor) anchorLines.push(`${t("labels.meals")}: ${anchors.mealTimingAnchor.instruction}`);

  details.appendChild(el("div", { text: `${t("labels.workoutSteps")}: ${workoutSteps}` }));
  details.appendChild(el("div", { text: `${t("labels.resetSteps")}: ${resetSteps}` }));
  details.appendChild(el("div", { text: `${t("labels.nutritionPriorities")}: ${nutrition}` }));
  if (anchorLines.length) {
    details.appendChild(el("div", { text: `${t("labels.anchors")}: ${anchorLines.join(" | ")}` }));
  }
  if (citationIds.length) {
    const citationLines = citationIds.map((id) => citationsById.get(id)?.title || id);
    details.appendChild(el("div", { text: `${t("labels.citations")}: ${citationLines.join(" • ")}` }));
  }
  const expanded = day.why?.expanded;
  if (expanded) {
    if (expanded.drivers?.length) {
      details.appendChild(el("div", { text: `${t("labels.whyDetails")}: ${expanded.drivers.join(" • ")}` }));
    }
    if (expanded.appliedRules?.length) {
      details.appendChild(
        el("div", { text: `${t("labels.appliedRules")}: ${expanded.appliedRules.join(", ")}` })
      );
    }
  }
  if (day.why?.safety?.disclaimer) {
    details.appendChild(el("div", { text: day.why.safety.disclaimer }));
  }
}

function initDay() {
  const dateInput = qs("#day-date");
  const loadBtn = qs("#day-load");
  const detailsToggle = qs("#day-details-toggle");
  const details = qs("#day-details");
  const signalButtons = qs("#signal-buttons");
  const badDayBtn = qs("#bad-day-btn");
  const checkinBtn = qs("#checkin-submit");
  const feedbackButtons = qsa("#feedback-buttons button");
  const feedbackKind = qs("#feedback-kind");
  const completionInputs = qsa("#completion-list input");
  const railSubmit = qs("#rail-submit");
  const railResetEl = qs("#rail-reset");
  const railViewFull = qs("#rail-view-full");
  const railDoneEl = qs("#rail-done");
  const railDoneView = qs("#rail-done-view");
  const communityList = qs("#community-list");
  const communityText = qs("#community-text");
  const communitySubmit = qs("#community-submit");
  const communityStatus = qs("#community-status");
  const prefsList = qs("#prefs-list");
  let currentResetId = null;
  let currentDay = null;
  let prefsMap = new Map();

  if (dateInput) dateInput.value = todayISO();

  const renderRailReset = (reset) => {
    if (!railResetEl) return;
    clear(railResetEl);
    if (railDoneEl) railDoneEl.classList.add("hidden");
    if (!reset) {
      railResetEl.appendChild(el("div", { class: "muted", text: t("rail.resetUnavailable") }));
      return;
    }
    railResetEl.appendChild(el("div", { class: "rail-title", text: t("rail.resetTitle") }));
    railResetEl.appendChild(
      el("div", { class: "rail-reset-name", text: `${reset.title || "Reset"} (${reset.minutes || 2} min)` })
    );
    const steps = Array.isArray(reset.steps) ? reset.steps : [];
    if (steps.length) {
      railResetEl.appendChild(el("div", { class: "muted", text: steps.slice(0, 3).join(" • ") }));
    }
  };

  const renderCommunity = (responses) => {
    if (!communityList) return;
    clear(communityList);
    const list = Array.isArray(responses) ? responses : [];
    if (!list.length) {
      communityList.appendChild(el("div", { class: "list-item muted", text: t("community.none") }));
      return;
    }
    list.forEach((entry) => {
      communityList.appendChild(el("div", { class: "list-item", text: entry.text }));
    });
  };

  const renderPrefs = (day) => {
    if (!prefsList) return;
    clear(prefsList);
    if (!day) {
      prefsList.appendChild(el("div", { class: "list-item muted", text: t("prefs.none") }));
      return;
    }
    const items = [
      { kind: "workout", item: day.what?.workout },
      { kind: "reset", item: day.what?.reset },
      { kind: "nutrition", item: day.what?.nutrition },
    ];
    items.forEach(({ kind, item }) => {
      if (!item?.id) return;
      const currentPref = prefsMap.get(item.id) || null;
      const row = el("div", { class: "list-item prefs-row" }, [
        el("div", { text: `${t(`labels.${kind}`)}: ${item.title || item.id}` }),
      ]);
      const favActive = currentPref === "favorite";
      const avoidActive = currentPref === "avoid";
      const favBtn = el("button", { text: favActive ? t("prefs.unfavorite") : t("prefs.favorite"), class: favActive ? "" : "ghost" });
      const avoidBtn = el("button", { text: avoidActive ? t("prefs.unavoid") : t("prefs.avoid"), class: avoidActive ? "" : "ghost" });
      favBtn.addEventListener("click", async () => {
        if (favActive) {
          await apiDelete(`/v1/content/prefs/${encodeURIComponent(item.id)}`);
          prefsMap.delete(item.id);
        } else {
          await apiPost("/v1/content/prefs", { itemId: item.id, pref: "favorite" });
          prefsMap.set(item.id, "favorite");
        }
        renderPrefs(currentDay);
      });
      avoidBtn.addEventListener("click", async () => {
        if (avoidActive) {
          await apiDelete(`/v1/content/prefs/${encodeURIComponent(item.id)}`);
          prefsMap.delete(item.id);
        } else {
          await apiPost("/v1/content/prefs", { itemId: item.id, pref: "avoid" });
          prefsMap.set(item.id, "avoid");
        }
        renderPrefs(currentDay);
      });
      row.appendChild(favBtn);
      row.appendChild(avoidBtn);
      prefsList.appendChild(row);
    });
  };

  const loadPrefs = async () => {
    try {
      const res = await apiGet("/v1/content/prefs");
      prefsMap = new Map((res.prefs || []).map((entry) => [entry.itemId, entry.pref]));
    } catch {
      prefsMap = new Map();
    }
    renderPrefs(currentDay);
  };

  const loadCommunity = async (resetId) => {
    if (!resetId) return;
    currentResetId = resetId;
    try {
      const res = await apiGet(`/v1/community/resets/${encodeURIComponent(resetId)}`);
      renderCommunity(res.responses || []);
    } catch (err) {
      if (getErrorCode(err) === "feature_disabled") {
        if (communityList) clear(communityList);
      }
    }
  };

  const consentGate = setupConsentGate(() => {
    loadDay();
  });

  const ensureConsent = async () => ensurePlanAccess(consentGate);

  const loadRail = async () => {
    try {
      const ok = await ensureConsent();
      if (!ok) return;
      if (railDoneEl) railDoneEl.classList.add("hidden");
      const res = await apiGet("/v1/rail/today");
      const dateISO = res.day?.dateISO || todayISO();
      if (dateInput) dateInput.value = dateISO;
      await ensureCitations();
      if (res.day) {
        renderDay(res.day);
        currentDay = res.day;
        renderPrefs(currentDay);
        const resetId = res.day?.what?.reset?.id;
        if (resetId) {
          await loadCommunity(resetId);
        } else {
          currentResetId = null;
          renderCommunity([]);
        }
      }
      renderRailReset(res.rail?.reset || null);
    } catch (err) {
      routeError(err, { consentGate });
    }
  };

  const loadDay = async () => {
    try {
      const ok = await ensureConsent();
      if (!ok) return;
      const dateISO = dateInput?.value || todayISO();
      if (railResetEl && dateISO === todayISO()) {
        await loadRail();
        return;
      }
      const res = await apiGet(`/v1/plan/day?date=${dateISO}`);
      await ensureCitations();
      renderDay(res.day);
      currentDay = res.day;
      renderPrefs(currentDay);
      const resetId = res.day?.what?.reset?.id;
      if (resetId) {
        await loadCommunity(resetId);
      } else {
        currentResetId = null;
        renderCommunity([]);
      }
    } catch (err) {
      routeError(err, { consentGate });
    }
  };

  loadBtn?.addEventListener("click", loadDay);
  loadDay();
  loadPrefs();

  railSubmit?.addEventListener("click", async () => {
    const dateISO = todayISO();
    if (dateInput) dateInput.value = dateISO;
    const checkIn = {
      dateISO,
      stress: Number(qs("#rail-stress")?.value || 5),
      sleepQuality: Number(qs("#rail-sleep")?.value || 6),
      energy: Number(qs("#rail-energy")?.value || 6),
      timeAvailableMin: Number(qs("#rail-time")?.value || 10),
    };
    const res = await apiPost("/v1/checkin", { checkIn });
    void res;
    await loadRail();
  });

  railViewFull?.addEventListener("click", () => {
    qs("#day-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  railDoneView?.addEventListener("click", () => {
    qs("#day-summary")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  detailsToggle?.addEventListener("click", () => {
    details?.classList.toggle("hidden");
    detailsToggle.textContent = details?.classList.contains("hidden") ? t("day.showDetails") : t("day.hideDetails");
    if (detailsToggle) {
      detailsToggle.setAttribute("aria-expanded", details?.classList.contains("hidden") ? "false" : "true");
    }
  });

  if (signalButtons) {
    clear(signalButtons);
    SIGNALS.forEach((signal) => {
      const btn = el("button", { text: signal.label });
      btn.addEventListener("click", async () => {
        const dateISO = dateInput?.value || todayISO();
        const res = await apiPost("/v1/signal", { dateISO, signal: signal.id });
        if (res.day) {
          if (railResetEl && dateISO === todayISO()) {
            await loadRail();
          } else {
            await ensureCitations();
            renderDay(res.day);
          }
        }
      });
      signalButtons.appendChild(btn);
    });
  }

  badDayBtn?.addEventListener("click", async () => {
    const dateISO = dateInput?.value || todayISO();
    const res = await apiPost("/v1/bad-day", { dateISO });
    if (res.day) {
      if (railResetEl && dateISO === todayISO()) {
        await loadRail();
      } else {
        await ensureCitations();
        renderDay(res.day);
      }
    }
  });

  checkinBtn?.addEventListener("click", async () => {
    const dateISO = dateInput?.value || todayISO();
    const checkIn = {
      dateISO,
      stress: Number(qs("#checkin-stress")?.value || 5),
      sleepQuality: Number(qs("#checkin-sleep")?.value || 6),
      energy: Number(qs("#checkin-energy")?.value || 6),
      timeAvailableMin: Number(qs("#checkin-time")?.value || 20),
      notes: qs("#checkin-notes")?.value || "",
    };
    const res = await apiPost("/v1/checkin", { checkIn });
    if (res.day) {
      if (railResetEl && dateISO === todayISO()) {
        await loadRail();
      } else {
        await ensureCitations();
        renderDay(res.day);
      }
    }
  });

  completionInputs.forEach((input) => {
    input.addEventListener("change", async () => {
      const part = input.dataset.part;
      const dateISO = dateInput?.value || todayISO();
      await apiPost("/v1/complete", { dateISO, part });
      if (part === "reset" && railDoneEl && dateISO === todayISO() && input.checked) {
        railDoneEl.classList.remove("hidden");
      }
    });
  });

  feedbackButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dateISO = dateInput?.value || todayISO();
      const helped = btn.dataset.helped === "true";
      const reasonCode = btn.dataset.reason || null;
      const kind = feedbackKind?.value || "reset";
      const itemId = currentDay?.what?.[kind]?.id || null;
      const payload = { dateISO, helped, kind, itemId };
      if (!helped) payload.reasonCode = reasonCode;
      await apiPost("/v1/feedback", payload);
    });
  });

  communitySubmit?.addEventListener("click", async () => {
    if (!currentResetId) return;
    const text = communityText?.value || "";
    if (communityStatus) communityStatus.textContent = "";
    try {
      await apiPost(`/v1/community/resets/${encodeURIComponent(currentResetId)}/respond`, { text });
      if (communityText) communityText.value = "";
      if (communityStatus) communityStatus.textContent = t("community.thanks");
    } catch (err) {
      const code = getErrorCode(err);
      if (communityStatus) {
        communityStatus.textContent =
          code === "opt_in_required" ? t("community.optInRequired") : t("community.submitFailed");
      }
    }
  });
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
      const ok = await ensureConsent();
      if (!ok) return;
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
      routeError(err, { consentGate });
    }
  };

  const consentGate = setupConsentGate(loadWeek);
  const ensureConsent = async () => ensurePlanAccess(consentGate);

  loadBtn?.addEventListener("click", loadWeek);
  loadWeek();
}

function initTrends() {
  const select = qs("#trends-days");
  const loadBtn = qs("#trends-load");
  const tbody = qs("#trends-table tbody");
  const outcomesSummary = qs("#outcomes-summary");
  const outcomesAnchors = qs("#outcomes-anchors tbody");
  const outcomesResets = qs("#outcomes-resets tbody");

  const loadTrends = async () => {
    try {
      const state = getAppState();
      if (!state.auth?.isAuthenticated) {
        routeError({ code: "auth_required" });
        return;
      }
      const days = select?.value || "7";
      const res = await apiGet(`/v1/trends?days=${days}`);
      clear(tbody);
      (res.days || []).forEach((row) => {
        const tr = el("tr", {}, [
          el("td", { text: row.dateISO }),
          el("td", { text: row.stressAvg != null ? row.stressAvg.toFixed(1) : "–" }),
          el("td", { text: row.sleepAvg != null ? row.sleepAvg.toFixed(1) : "–" }),
          el("td", { text: row.energyAvg != null ? row.energyAvg.toFixed(1) : "–" }),
          el("td", { text: row.anyPart == null ? "–" : row.anyPart ? t("misc.yes") : t("misc.no") }),
          el("td", { text: formatMinutes(row.downshiftMinutes) }),
        ]);
        tbody.appendChild(tr);
      });
      const outcomes = await apiGet(`/v1/outcomes?days=${days}`);
      if (outcomesSummary) {
        clear(outcomesSummary);
        outcomesSummary.appendChild(
          el("div", { class: "list-item" }, [
            el("div", { text: t("outcomes.daysAny") }),
            el("div", { class: "muted", text: String(outcomes.metrics?.daysAnyRegulationAction ?? 0) }),
          ])
        );
      }
      if (outcomesAnchors) {
        clear(outcomesAnchors);
        (outcomes.metrics?.anchorsCompletedTrend || []).forEach((row) => {
          const tr = el("tr", {}, [
            el("td", { text: row.dateISO }),
            el("td", { text: row.sunlight ? t("misc.yes") : t("misc.no") }),
            el("td", { text: row.meal ? t("misc.yes") : t("misc.no") }),
            el("td", { text: row.downshift ? t("misc.yes") : t("misc.no") }),
          ]);
          outcomesAnchors.appendChild(tr);
        });
      }
      if (outcomesResets) {
        clear(outcomesResets);
        (outcomes.metrics?.topResets || []).forEach((entry) => {
          const tr = el("tr", {}, [
            el("td", { text: entry.title || entry.resetId }),
            el("td", { text: String(entry.completedCount || 0) }),
            el("td", { text: entry.lastUsedAtISO || "–" }),
          ]);
          outcomesResets.appendChild(tr);
        });
      }
    } catch (err) {
      routeError(err);
    }
  };

  loadBtn?.addEventListener("click", loadTrends);
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
      appState.envMode === "dogfood" ||
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
    const ok = await ensurePlanAccess();
    if (!ok) return;
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
      routeError(err);
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

export {
  initBaseUi,
  bootstrapApp,
  getAppState,
  setAppState,
  routeError,
  setupConsentGate,
  ensurePlanAccess,
  bindAuth,
  updateAdminVisibility,
  initDay,
  initWeek,
  initTrends,
  initProfile,
  initAdmin,
  t,
};
