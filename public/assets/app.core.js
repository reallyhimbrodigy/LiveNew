import {
  apiGet,
  apiPost,
  apiPatch,
  requestAuth,
  verifyAuth,
  getToken,
  setToken,
  clearToken,
  setDeviceName,
  getDeviceName,
  ensureCsrf,
} from "./app.api.js";
import { qs, qsa, el, clear, setText, formatMinutes, formatPct } from "./app.ui.js";

const SIGNALS = [
  { id: "im_stressed", label: "I’m stressed" },
  { id: "im_exhausted", label: "I’m exhausted" },
  { id: "i_have_10_min", label: "I have 10 min" },
  { id: "i_have_more_energy", label: "I have more energy" },
  { id: "poor_sleep", label: "Poor sleep" },
  { id: "anxious", label: "Anxious" },
  { id: "wired", label: "Wired" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function init() {
  await ensureCsrf();
  bindAuth();
  await updateAdminVisibility();

  const page = document.body.dataset.page;
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
    setText(qs("#auth-status"), "Code sent. Check server logs if dev.");
  });

  verifyBtn?.addEventListener("click", async () => {
    const email = emailInput?.value?.trim();
    const code = codeInput?.value?.trim();
    if (!email || !code) return;
    const res = await verifyAuth(email, code);
    if (res?.token) {
      setToken(res.token);
      updateAuthStatus();
      await updateAdminVisibility();
    }
  });

  logoutBtn?.addEventListener("click", () => {
    clearToken();
    updateAuthStatus();
    updateAdminVisibility();
  });
}

function updateAuthStatus() {
  const status = qs("#auth-status");
  if (!status) return;
  status.textContent = getToken() ? "Signed in" : "Not signed in";
}

async function updateAdminVisibility() {
  const adminLinks = qsa(".admin-link");
  adminLinks.forEach((link) => (link.style.display = "none"));
  if (!getToken()) return;
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
  setText(qs("#day-what"),
    `Workout: ${day.what.workout.title || "–"} (${day.what.workout.minutes || "–"} min)\n` +
    `Reset: ${day.what.reset.title || "–"} (${day.what.reset.minutes || "–"} min)\n` +
    `Nutrition: ${day.what.nutrition.title || "–"}`
  );
  setText(qs("#day-why"),
    `Profile: ${day.why.profile || "–"}\n` +
    `Focus: ${day.why.focus || "–"}\n` +
    `${day.why.statement || ""}\n` +
    `${(day.why.rationale || []).join(" | ")}`
  );
  setText(qs("#day-howlong"),
    `Total: ${formatMinutes(day.howLong.totalMinutes)}\n` +
    `Available: ${day.howLong.timeAvailableMin || "–"} min`
  );

  const details = qs("#day-details");
  if (!details) return;
  clear(details);
  const workoutSteps = (day.details.workoutSteps || []).join(" • ") || "–";
  const resetSteps = (day.details.resetSteps || []).join(" • ") || "–";
  const nutrition = (day.details.nutritionPriorities || []).join(" • ") || "–";
  const anchors = day.details.anchors;
  const anchorLines = [];
  if (anchors?.sunlightAnchor) anchorLines.push(`Sunlight: ${anchors.sunlightAnchor.instruction}`);
  if (anchors?.mealTimingAnchor) anchorLines.push(`Meals: ${anchors.mealTimingAnchor.instruction}`);

  details.appendChild(el("div", { text: `Workout steps: ${workoutSteps}` }));
  details.appendChild(el("div", { text: `Reset steps: ${resetSteps}` }));
  details.appendChild(el("div", { text: `Nutrition priorities: ${nutrition}` }));
  if (anchorLines.length) {
    details.appendChild(el("div", { text: `Anchors: ${anchorLines.join(" | ")}` }));
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
    detailsToggle.textContent = details?.classList.contains("hidden") ? "Show details" : "Hide details";
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
        el("td", { text: row.anyPart ? "Yes" : "No" }),
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
      qs("#profile-pack").value = profile.contentPack || "balanced_routine";
    } catch {
      // ignore
    }
  };

  const loadSessions = async () => {
    if (!getToken()) return;
    const res = await apiGet("/v1/account/sessions");
    clear(sessionsList);
    (res.sessions || []).forEach((session) => {
      const row = el("div", { class: "list-item" }, [
        el("div", { text: session.deviceName || "Unnamed device" }),
        el("div", { class: "muted", text: `Last seen: ${session.lastSeenAt || session.createdAt}` }),
      ]);
      if (!session.isCurrent) {
        const btn = el("button", { text: "Revoke", class: "ghost" });
        btn.addEventListener("click", async () => {
          await apiPost("/v1/account/sessions/revoke", { token: session.token });
          loadSessions();
        });
        row.appendChild(btn);
      } else {
        row.appendChild(el("div", { class: "muted", text: "Current session" }));
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
    };
    await apiPost("/v1/profile", { userProfile });
  });

  deviceSave?.addEventListener("click", async () => {
    const name = deviceInput?.value?.trim();
    if (!name) return;
    setDeviceName(name);
    if (getToken()) await apiPost("/v1/account/sessions/name", { deviceName: name });
    loadSessions();
  });

  if (getDeviceName() && deviceInput) deviceInput.value = getDeviceName();
  loadProfile();
  loadSessions();
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
        setText(guardText, "Admin access required.");
        showPanel(false);
        return false;
      }
      showPanel(true);
      return true;
    } catch {
      setText(guardText, "Admin access required.");
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
        el("div", { class: "muted", text: `${item.enabled === false ? "Disabled" : "Enabled"} • priority ${item.priority}` }),
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
        el("div", { class: "muted", text: `Picked ${stats.picked} • Not relevant ${formatPct(stats.notRelevantRate)}` }),
      ]);
      const btn = el("button", { text: "Disable", class: "ghost" });
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

  const loadParameters = async () => {
    const res = await apiGet("/v1/admin/parameters");
    const list = qs("#params-list");
    clear(list);
    Object.entries(res.parameters || {}).forEach(([key, value]) => {
      const textarea = el("textarea", { rows: 6 }, []);
      textarea.value = JSON.stringify(value, null, 2);
      const saveBtn = el("button", { text: "Save", class: "ghost" });
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

  const bindButtons = () => {
    qs("#admin-content-load")?.addEventListener("click", loadContentList);
    qs("#content-save")?.addEventListener("click", saveEditor);
    qs("#content-disable")?.addEventListener("click", disableItem);
    qs("#worst-load")?.addEventListener("click", loadWorst);
    qs("#heatmap-load")?.addEventListener("click", loadHeatmap);
  };

  checkAdmin().then((ok) => {
    if (!ok) return;
    initTabs();
    bindButtons();
    loadContentList();
    loadWorst();
    loadHeatmap();
    loadParameters();
  });
}

init().catch((err) => console.error(err));
