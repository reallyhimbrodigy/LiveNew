import {
  apiGet,
  apiPost,
  apiPatch,
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
  ensureCsrf,
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function init() {
  await ensureCsrf();
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
  bindAuth();
  await updateAdminVisibility();
  if (page === "day") initDay();
  if (page === "week") initWeek();
  if (page === "trends") initTrends();
  if (page === "profile") initProfile();
  if (page === "admin") initAdmin();
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
  setText(
    whyEl,
    `${t("labels.profile")}: ${day.why.profile || "–"}\n` +
      `${t("labels.focus")}: ${day.why.focus || "–"}\n` +
      `${short}\n` +
      `${whyNot}`
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
  const anchorLines = [];
  if (anchors?.sunlightAnchor) anchorLines.push(`${t("labels.sunlight")}: ${anchors.sunlightAnchor.instruction}`);
  if (anchors?.mealTimingAnchor) anchorLines.push(`${t("labels.meals")}: ${anchors.mealTimingAnchor.instruction}`);

  details.appendChild(el("div", { text: `${t("labels.workoutSteps")}: ${workoutSteps}` }));
  details.appendChild(el("div", { text: `${t("labels.resetSteps")}: ${resetSteps}` }));
  details.appendChild(el("div", { text: `${t("labels.nutritionPriorities")}: ${nutrition}` }));
  if (anchorLines.length) {
    details.appendChild(el("div", { text: `${t("labels.anchors")}: ${anchorLines.join(" | ")}` }));
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
  const feedbackBtn = qs("#feedback-submit");
  const completionInputs = qsa("#completion-list input");

  if (dateInput) dateInput.value = todayISO();

  const loadDay = async () => {
    const dateISO = dateInput?.value || todayISO();
    const res = await apiGet(`/v1/plan/day?date=${dateISO}`);
    renderDay(res.day);
  };

  loadBtn?.addEventListener("click", loadDay);
  loadDay();

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
        if (res.day) renderDay(res.day);
      });
      signalButtons.appendChild(btn);
    });
  }

  badDayBtn?.addEventListener("click", async () => {
    const dateISO = dateInput?.value || todayISO();
    const res = await apiPost("/v1/bad-day", { dateISO });
    if (res.day) renderDay(res.day);
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
    if (res.day) renderDay(res.day);
  });

  completionInputs.forEach((input) => {
    input.addEventListener("change", async () => {
      const part = input.dataset.part;
      const dateISO = dateInput?.value || todayISO();
      await apiPost("/v1/complete", { dateISO, part });
    });
  });

  feedbackBtn?.addEventListener("click", async () => {
    const dateISO = dateInput?.value || todayISO();
    const helped = qs("#feedback-helped")?.value === "yes";
    const reason = qs("#feedback-reason")?.value;
    await apiPost("/v1/feedback", { dateISO, helped, reason: helped ? undefined : reason });
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
  };

  loadBtn?.addEventListener("click", loadWeek);
  loadWeek();
}

function initTrends() {
  const select = qs("#trends-days");
  const loadBtn = qs("#trends-load");
  const tbody = qs("#trends-table tbody");

  const loadTrends = async () => {
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
  };

  loadBtn?.addEventListener("click", loadTrends);
  loadTrends();
}

function initProfile() {
  const saveBtn = qs("#profile-save");
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

  saveBtn?.addEventListener("click", async () => {
    const userProfile = {
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
    };
    await apiPost("/v1/profile", { userProfile });
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
    const res = await apiGet(`/v1/plan/changes?date=${changesDate.value}`);
    clear(changesList);
    (res.items || []).forEach((item) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: item.summary?.short || t("misc.planUpdated") }),
        el("div", { class: "muted", text: item.createdAt }),
      ]);
      changesList.appendChild(row);
    });
  };

  changesLoad?.addEventListener("click", loadChanges);
  if (changesDate) changesDate.value = todayISO();

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
}

function initAdmin() {
  const guardText = qs("#admin-guard-text");
  const panel = qs("#admin-panel");
  const guard = qs("#admin-guard");

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
    qs("#worst-load")?.addEventListener("click", loadWorst);
    qs("#heatmap-load")?.addEventListener("click", loadHeatmap);
    qs("#cohorts-load")?.addEventListener("click", loadCohorts);
    qs("#cohort-assign")?.addEventListener("click", assignCohort);
    qs("#admin-reminders-load")?.addEventListener("click", loadAdminReminders);
    qs("#weekly-load")?.addEventListener("click", loadWeeklyReport);
    qs("#weekly-download")?.addEventListener("click", downloadWeeklyReport);
    qs("#weekly-disable-all")?.addEventListener("click", disableWeeklyCandidates);
    qs("#weekly-bump")?.addEventListener("click", bumpWeeklyPriority);
  };

  checkAdmin().then((ok) => {
    if (!ok) return;
    initTabs();
    bindButtons();
    loadContentList();
    loadWorst();
    loadHeatmap();
    loadParameters();
    const adminRemindersDate = qs("#admin-reminders-date");
    if (adminRemindersDate) adminRemindersDate.value = todayISO();
    loadCohorts();
    loadAdminReminders();
    loadWeeklyReport();
  });
}

init().catch((err) => console.error(err));
