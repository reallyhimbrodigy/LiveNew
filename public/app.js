const statusEls = {
  profile: document.getElementById("profile-status"),
  day: document.getElementById("day-status"),
  checkin: document.getElementById("checkin-status"),
  completion: document.getElementById("completion-status"),
  feedback: document.getElementById("feedback-status"),
  snapshot: document.getElementById("snapshot-status"),
};

const dayDateInput = document.getElementById("day-date");
const checkinDateInput = document.getElementById("checkin-date");
const feedbackDateInput = document.getElementById("feedback-date");

const dayContractEl = document.getElementById("day-contract");
const tomorrowPanel = document.getElementById("tomorrow-panel");
const tomorrowContract = document.getElementById("tomorrow-contract");

const completionButtons = Array.from(document.querySelectorAll("#completion-buttons button"));

const scenarioSelect = document.getElementById("scenario-select");
const snapshotSelect = document.getElementById("snapshot-select");

const scenarioOptions = [
  "no_checkins",
  "poor_sleep_day",
  "wired_day",
  "ten_min_day",
  "busy_day",
  "bad_day_mode",
  "feedback_too_hard",
  "feedback_not_relevant",
  "balanced_day",
  "depleted_day",
];

let csrfToken = null;
let csrfPromise = null;

function setStatus(key, message, tone = "") {
  const el = statusEls[key];
  if (!el) return;
  el.textContent = message || "";
  el.dataset.tone = tone;
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch("/v1/csrf", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((payload) => {
        csrfToken = payload?.token || null;
        if (!csrfToken) csrfPromise = null;
        return csrfToken;
      })
      .catch(() => {
        csrfPromise = null;
        return null;
      });
  }
  return csrfPromise;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  const method = options.method || "GET";
  if (method !== "GET") {
    const token = await ensureCsrfToken();
    if (token) headers["x-csrf-token"] = token;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok || (payload && payload.ok === false)) {
    const errorMessage = payload?.error?.message || payload?.error || res.statusText || "request_failed";
    throw new Error(errorMessage);
  }
  return payload;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function setText(root, selector, value, fallback = "-") {
  const el = root.querySelector(selector);
  if (!el) return;
  el.textContent = value == null || value === "" ? fallback : value;
}

function renderList(root, selector, items) {
  const el = root.querySelector(selector);
  if (!el) return;
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

function renderChips(root, selector, items) {
  const el = root.querySelector(selector);
  if (!el) return;
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = item;
    el.appendChild(span);
  });
}

function formatWhat(item) {
  if (!item || !item.title) return "-";
  const minutes = item.minutes != null ? `${item.minutes} min` : null;
  const windowLabel = item.window ? `${item.window} window` : null;
  const parts = [item.title, minutes, windowLabel].filter(Boolean);
  return parts.join(" - ");
}

function renderDayContract(day, root) {
  if (!day || !root) return;
  setText(root, "[data-what-workout]", formatWhat(day.what.workout));
  setText(root, "[data-what-reset]", formatWhat(day.what.reset));
  setText(root, "[data-what-nutrition]", day.what.nutrition?.title || "-");

  setText(root, "[data-why-profile]", day.why.profile);
  setText(root, "[data-why-focus]", day.why.focus);
  setText(root, "[data-why-statement]", day.why.statement);
  renderChips(root, "[data-why-drivers]", day.why.drivers);

  setText(root, "[data-howlong-total]", day.howLong.totalMinutes != null ? `${day.howLong.totalMinutes} min` : "-");
  setText(root, "[data-howlong-available]", day.howLong.timeAvailableMin != null ? `${day.howLong.timeAvailableMin} min` : "-");

  renderList(root, "[data-details-workout]", day.details.workoutSteps);
  renderList(root, "[data-details-reset]", day.details.resetSteps);
  renderList(root, "[data-details-nutrition]", day.details.nutritionPriorities);
}

function renderProgress(progress) {
  const panel = document.getElementById("progress-panel");
  if (!panel) return;
  if (!progress) {
    panel.textContent = "No progress yet.";
    return;
  }
  panel.innerHTML = `
    <div><strong>Stress avg (7d):</strong> ${progress.stressAvg7?.toFixed ? progress.stressAvg7.toFixed(1) : "-"}</div>
    <div><strong>Sleep avg (7d):</strong> ${progress.sleepAvg7?.toFixed ? progress.sleepAvg7.toFixed(1) : "-"}</div>
    <div><strong>Adherence:</strong> ${progress.adherencePct ?? "-"}</div>
    <div><strong>Downshift minutes (7d):</strong> ${progress.downshiftMinutes7 ?? "-"}</div>
  `;
}

function renderCompletionButtons(completion) {
  completionButtons.forEach((button) => {
    const part = button.dataset.part;
    const isActive = completion && completion[part];
    button.classList.toggle("active", Boolean(isActive));
  });
}

function renderTrends(days) {
  const panel = document.getElementById("trends-panel");
  if (!panel) return;
  if (!Array.isArray(days) || !days.length) {
    panel.textContent = "No trend data yet.";
    return;
  }
  const rows = days
    .map(
      (day) => `\n      <tr>\n        <td>${day.dateISO}</td>\n        <td>${day.stressAvg != null ? day.stressAvg.toFixed(1) : "-"}</td>\n        <td>${day.sleepAvg != null ? day.sleepAvg.toFixed(1) : "-"}</td>\n        <td>${day.anyPartCompletion == null ? "-" : day.anyPartCompletion ? "yes" : "no"}</td>\n        <td>${day.downshiftMinutes != null ? day.downshiftMinutes : "-"}</td>\n      </tr>`
    )
    .join(" ");
  panel.innerHTML = `
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align:left; padding: 4px 0;">Date</th>
          <th style="text-align:left; padding: 4px 0;">Stress</th>
          <th style="text-align:left; padding: 4px 0;">Sleep</th>
          <th style="text-align:left; padding: 4px 0;">Any part</th>
          <th style="text-align:left; padding: 4px 0;">Downshift min</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadDay(dateISO) {
  setStatus("day", "Loading day...");
  try {
    const res = await api(`/v1/plan/day?date=${dateISO}`);
    renderDayContract(res.day, dayContractEl);
    setStatus("day", `Loaded day ${dateISO}.`, "success");
  } catch (err) {
    setStatus("day", `Day load failed: ${err.message}`, "error");
  }
}

async function refreshProgress() {
  try {
    const res = await api("/v1/progress");
    renderProgress(res.progress);
  } catch (err) {
    renderProgress(null);
  }
}

async function refreshTrends() {
  const select = document.getElementById("trends-days");
  const days = select ? Number(select.value) : 7;
  try {
    const res = await api(`/v1/trends?days=${days}`);
    renderTrends(res.days);
  } catch (err) {
    renderTrends([]);
  }
}

function collectProfile() {
  const preferred = document.getElementById("preferredWindow").value;
  const busy = document
    .getElementById("busyDays")
    .value.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    wakeTime: document.getElementById("wakeTime").value,
    bedTime: document.getElementById("bedTime").value,
    sleepRegularity: Number(document.getElementById("sleepRegularity").value),
    sunlightMinutesPerDay: Number(document.getElementById("sunlightMinutes").value),
    caffeineCupsPerDay: Number(document.getElementById("caffeineCups").value),
    lateScreenMinutesPerNight: Number(document.getElementById("lateScreen").value),
    preferredWorkoutWindows: [preferred],
    busyDays: busy,
  };
}

function collectCheckIn() {
  return {
    dateISO: checkinDateInput.value,
    stress: Number(document.getElementById("checkin-stress").value),
    sleepQuality: Number(document.getElementById("checkin-sleep").value),
    energy: Number(document.getElementById("checkin-energy").value),
    timeAvailableMin: Number(document.getElementById("checkin-time").value),
    notes: document.getElementById("checkin-notes").value || undefined,
  };
}

async function initDevPanel() {
  if (!window.__IS_DEV__) return;
  try {
    const res = await api("/v1/dev/bundle");
    const bundle = res.bundle;
    document.getElementById("dev-panel").style.display = "block";
    document.getElementById("debug-bundle").textContent = JSON.stringify(bundle, null, 2);

    const toggles = bundle.ruleToggles || {};
    document.getElementById("rule-constraints").checked = toggles.constraintsEnabled !== false;
    document.getElementById("rule-novelty").checked = toggles.noveltyEnabled !== false;
    document.getElementById("rule-feedback").checked = toggles.feedbackEnabled !== false;
    document.getElementById("rule-badday").checked = toggles.badDayEnabled !== false;
  } catch (err) {
    // dev panel stays hidden
  }
}

function populateDevSelects() {
  scenarioOptions.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id.replace(/_/g, " ");
    scenarioSelect.appendChild(option);
  });

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All snapshots";
  snapshotSelect.appendChild(allOption);

  scenarioOptions.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id.replace(/_/g, " ");
    snapshotSelect.appendChild(option);
  });
}

function renderTomorrow(day) {
  if (!day) {
    tomorrowPanel.style.display = "none";
    return;
  }
  tomorrowPanel.style.display = "block";
  tomorrowContract.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "plan-grid";
  wrapper.innerHTML = dayContractEl.innerHTML;
  tomorrowContract.appendChild(wrapper);
  renderDayContract(day, tomorrowContract);
}

function bindEvents() {
  document.getElementById("save-profile").addEventListener("click", async () => {
    setStatus("profile", "Saving profile...");
    try {
      const res = await api("/v1/profile", { method: "POST", body: { userProfile: collectProfile() } });
      setStatus("profile", `Saved profile. Week starts ${res.weekPlan?.startDateISO || "-"}.`, "success");
      await loadDay(dayDateInput.value);
    } catch (err) {
      setStatus("profile", `Profile save failed: ${err.message}`, "error");
    }
  });

  document.getElementById("load-day").addEventListener("click", async () => {
    await loadDay(dayDateInput.value);
  });

  document.getElementById("signal-buttons").addEventListener("click", async (event) => {
    const signal = event.target.dataset.signal;
    if (!signal) return;
    setStatus("day", `Applying signal ${signal}...`);
    try {
      const res = await api("/v1/signal", {
        method: "POST",
        body: { dateISO: dayDateInput.value, signal },
      });
      renderDayContract(res.day, dayContractEl);
      setStatus("day", `Signal applied: ${signal}.`, "success");
    } catch (err) {
      setStatus("day", `Signal failed: ${err.message}`, "error");
    }
  });

  document.getElementById("bad-day").addEventListener("click", async () => {
    setStatus("day", "Applying bad day mode...");
    try {
      const res = await api("/v1/bad-day", { method: "POST", body: { dateISO: dayDateInput.value } });
      renderDayContract(res.day, dayContractEl);
      setStatus("day", "Bad day mode applied.", "success");
    } catch (err) {
      setStatus("day", `Bad day mode failed: ${err.message}`, "error");
    }
  });

  document.getElementById("checkin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("checkin", "Submitting check-in...");
    try {
      const res = await api("/v1/checkin", { method: "POST", body: { checkIn: collectCheckIn() } });
      if (res.day) renderDayContract(res.day, dayContractEl);
      renderTomorrow(res.tomorrow);
      setStatus("checkin", "Check-in saved.", "success");
      await refreshProgress();
    } catch (err) {
      setStatus("checkin", `Check-in failed: ${err.message}`, "error");
    }
  });

  completionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      setStatus("completion", "Updating completion...");
      try {
        const res = await api("/v1/complete", {
          method: "POST",
          body: { dateISO: dayDateInput.value, part: button.dataset.part },
        });
        renderCompletionButtons(res.completion);
        renderProgress(res.progress);
        setStatus("completion", "Completion updated.", "success");
      } catch (err) {
        setStatus("completion", `Completion failed: ${err.message}`, "error");
      }
    });
  });

  document.getElementById("submit-feedback").addEventListener("click", async () => {
    setStatus("feedback", "Sending feedback...");
    try {
      await api("/v1/feedback", {
        method: "POST",
        body: {
          dateISO: feedbackDateInput.value,
          helped: document.getElementById("feedback-helped").value === "true",
          reason: document.getElementById("feedback-reason").value || undefined,
        },
      });
      setStatus("feedback", "Feedback saved.", "success");
    } catch (err) {
      setStatus("feedback", `Feedback failed: ${err.message}`, "error");
    }
  });

  document.getElementById("refresh-progress").addEventListener("click", async () => {
    await refreshProgress();
  });

  document.getElementById("refresh-trends")?.addEventListener("click", async () => {
    await refreshTrends();
  });

  document.getElementById("trends-days")?.addEventListener("change", async () => {
    await refreshTrends();
  });

  document.getElementById("save-rules")?.addEventListener("click", async () => {
    setStatus("snapshot", "Saving rule toggles...");
    try {
      const res = await api("/v1/dev/rules", {
        method: "POST",
        body: {
          ruleToggles: {
            constraintsEnabled: document.getElementById("rule-constraints").checked,
            noveltyEnabled: document.getElementById("rule-novelty").checked,
            feedbackEnabled: document.getElementById("rule-feedback").checked,
            badDayEnabled: document.getElementById("rule-badday").checked,
          },
        },
      });
      document.getElementById("debug-bundle").textContent = JSON.stringify(res, null, 2);
      setStatus("snapshot", "Rules updated.", "success");
      await loadDay(dayDateInput.value);
    } catch (err) {
      setStatus("snapshot", `Rule update failed: ${err.message}`, "error");
    }
  });

  document.getElementById("run-scenario")?.addEventListener("click", async () => {
    setStatus("snapshot", "Applying scenario...");
    try {
      const res = await api("/v1/dev/scenario", {
        method: "POST",
        body: { scenarioId: scenarioSelect.value },
      });
      renderDayContract(res.day, dayContractEl);
      setStatus("snapshot", `Scenario applied: ${res.scenarioId}`, "success");
    } catch (err) {
      setStatus("snapshot", `Scenario failed: ${err.message}`, "error");
    }
  });

  document.getElementById("run-snapshot")?.addEventListener("click", async () => {
    setStatus("snapshot", "Running snapshot checks...");
    try {
      const res = await api("/v1/dev/snapshot/run", {
        method: "POST",
        body: { scenarioId: snapshotSelect.value || undefined },
      });
      setStatus(
        "snapshot",
        `Snapshots complete. ${res.results.filter((r) => r.ok).length}/${res.results.length} passing.`,
        "success"
      );
    } catch (err) {
      setStatus("snapshot", `Snapshot run failed: ${err.message}`, "error");
    }
  });
}

function initDates() {
  const today = isoToday();
  [dayDateInput, checkinDateInput, feedbackDateInput].forEach((input) => {
    if (input) input.value = today;
  });
}

function bootstrap() {
  ensureCsrfToken();
  initDates();
  populateDevSelects();
  bindEvents();
  loadDay(dayDateInput.value);
  refreshProgress();
  refreshTrends();
  initDevPanel();
}

bootstrap();
