const authStatusEl = document.getElementById("auth-status");
const authMessageEl = document.getElementById("auth-message");
const authEmailInput = document.getElementById("auth-email");
const authCodeInput = document.getElementById("auth-code");
const adminTab = document.getElementById("admin-tab");

const dayDateInput = document.getElementById("day-date");
const checkinDateInput = document.getElementById("checkin-date");
const feedbackDateInput = document.getElementById("feedback-date");
const weekDateInput = document.getElementById("week-date");

const statusEls = {
  day: document.getElementById("day-status"),
  checkin: document.getElementById("checkin-status"),
  completion: document.getElementById("completion-status"),
  feedback: document.getElementById("feedback-status"),
  profile: document.getElementById("profile-status"),
  week: document.getElementById("week-status"),
  admin: document.getElementById("admin-status"),
};

let authToken = localStorage.getItem("livenew_token") || "";
let csrfToken = null;
let csrfPromise = null;
let isAdminUser = false;

const adminState = {
  items: [],
  selectedIds: new Set(),
  selectedItem: null,
};

function setStatus(key, message, tone) {
  const el = statusEls[key];
  if (!el) return;
  el.textContent = message || "";
  el.className = `status ${tone || ""}`.trim();
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function setAuthStatus() {
  if (authToken) {
    authStatusEl.textContent = isAdminUser ? "Signed in (admin)" : "Signed in";
  } else {
    authStatusEl.textContent = "Not signed in";
  }
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
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (method !== "GET" && method !== "HEAD") {
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
    const msg = payload?.error?.message || payload?.error || res.statusText || "request_failed";
    throw new Error(msg);
  }
  return payload;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.style.display = view.id === `view-${name}` ? "block" : "none";
  });
}

function setText(id, value, fallback = "-") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null || value === "" ? fallback : value;
}

function renderList(el, items) {
  if (!el) return;
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

function renderChips(el, items) {
  if (!el) return;
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item;
    el.appendChild(span);
  });
}

function formatWhat(item) {
  if (!item) return "-";
  const parts = [item.title, item.minutes ? `${item.minutes} min` : null, item.window ? `${item.window} window` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "-";
}

function renderAnchors(anchors) {
  const el = document.getElementById("day-anchors");
  if (!el) return;
  if (!anchors) {
    el.textContent = "-";
    return;
  }
  const lines = [];
  if (anchors.sunlightAnchor) {
    lines.push(`${anchors.sunlightAnchor.instruction}`);
  }
  if (anchors.mealTimingAnchor) {
    lines.push(`${anchors.mealTimingAnchor.instruction}`);
  }
  el.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
}

function renderDay(day) {
  if (!day) return;
  setText("day-what-workout", formatWhat(day.what.workout));
  setText("day-what-reset", formatWhat(day.what.reset));
  setText("day-what-nutrition", day.what.nutrition?.title || "-");

  setText("day-why-profile", day.why.profile);
  setText("day-why-focus", day.why.focus);
  setText("day-why-statement", day.why.statement, "");
  renderChips(document.getElementById("day-why-drivers"), day.why.drivers || []);

  setText("day-howlong-total", day.howLong.totalMinutes != null ? `${day.howLong.totalMinutes} min` : "-");
  setText("day-howlong-available", day.howLong.timeAvailableMin != null ? `${day.howLong.timeAvailableMin} min` : "-");

  renderList(document.getElementById("day-workout-steps"), day.details.workoutSteps || []);
  renderList(document.getElementById("day-reset-steps"), day.details.resetSteps || []);
  renderList(document.getElementById("day-nutrition-priorities"), day.details.nutritionPriorities || []);
  renderAnchors(day.details.anchors || null);
}

function renderWeek(plan) {
  const list = document.getElementById("week-list");
  if (!list) return;
  if (!plan || !plan.days) {
    list.textContent = "No week plan yet.";
    return;
  }
  list.innerHTML = plan.days
    .map(
      (day) => `
        <div>
          <strong>${day.dateISO}</strong> · ${day.focus || "-"}
          <div class="muted">${day.workout?.title || "-"}</div>
        </div>`
    )
    .join("");
}

function renderTrends(days) {
  const table = document.getElementById("trends-table");
  if (!table) return;
  if (!Array.isArray(days) || !days.length) {
    table.textContent = "No trend data.";
    return;
  }
  const rows = days
    .map(
      (day) => `
      <tr>
        <td>${day.dateISO}</td>
        <td>${day.stressAvg != null ? day.stressAvg.toFixed(1) : "-"}</td>
        <td>${day.sleepAvg != null ? day.sleepAvg.toFixed(1) : "-"}</td>
        <td>${day.anyPartCompletion == null ? "-" : day.anyPartCompletion ? "yes" : "no"}</td>
        <td>${day.downshiftMinutes != null ? day.downshiftMinutes : "-"}</td>
      </tr>`
    )
    .join("");
  table.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Stress</th>
          <th>Sleep</th>
          <th>Any part</th>
          <th>Downshift min</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadDay(dateISO) {
  setStatus("day", "Loading day...");
  try {
    const res = await api(`/v1/plan/day?date=${dateISO}`);
    renderDay(res.day);
    setStatus("day", `Loaded ${dateISO}.`, "success");
  } catch (err) {
    setStatus("day", err.message, "error");
  }
}

async function loadWeek(dateISO) {
  setStatus("week", "Loading week...");
  try {
    const query = dateISO ? `?date=${dateISO}` : "";
    const res = await api(`/v1/plan/week${query}`);
    renderWeek(res.weekPlan);
    setStatus("week", "Week loaded.", "success");
  } catch (err) {
    setStatus("week", err.message, "error");
  }
}

async function loadTrends(days) {
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
    caffeineCupsPerDay: Number(document.getElementById("caffeineCups").value),
    lateCaffeineDaysPerWeek: Number(document.getElementById("lateCaffeineDays").value),
    sunlightMinutesPerDay: Number(document.getElementById("sunlightMinutes").value),
    lateScreenMinutesPerNight: Number(document.getElementById("lateScreen").value),
    alcoholNightsPerWeek: Number(document.getElementById("alcoholNights").value),
    mealTimingConsistency: Number(document.getElementById("mealTiming").value),
    preferredWorkoutWindows: [preferred],
    busyDays: busy,
  };
}

async function loadProfile() {
  try {
    const res = await api("/v1/account/export");
    const profile = res.export?.userProfile;
    if (!profile) return;
    document.getElementById("wakeTime").value = profile.wakeTime || "";
    document.getElementById("bedTime").value = profile.bedTime || "";
    document.getElementById("sleepRegularity").value = profile.sleepRegularity ?? 6;
    document.getElementById("caffeineCups").value = profile.caffeineCupsPerDay ?? 1;
    document.getElementById("lateCaffeineDays").value = profile.lateCaffeineDaysPerWeek ?? 0;
    document.getElementById("sunlightMinutes").value = profile.sunlightMinutesPerDay ?? 15;
    document.getElementById("lateScreen").value = profile.lateScreenMinutesPerNight ?? 30;
    document.getElementById("alcoholNights").value = profile.alcoholNightsPerWeek ?? 0;
    document.getElementById("mealTiming").value = profile.mealTimingConsistency ?? 6;
    document.getElementById("preferredWindow").value = (profile.preferredWorkoutWindows || ["PM"])[0];
    document.getElementById("busyDays").value = (profile.busyDays || []).join(", ");
  } catch (err) {
    // ignore
  }
}

async function handleAuthStatus() {
  if (!authToken) {
    isAdminUser = false;
    adminTab.style.display = "none";
    setAuthStatus();
    return;
  }
  try {
    const res = await api("/v1/admin/me");
    isAdminUser = Boolean(res.isAdmin);
    adminTab.style.display = isAdminUser ? "inline-flex" : "none";
    setAuthStatus();
  } catch (err) {
    authToken = "";
    localStorage.removeItem("livenew_token");
    isAdminUser = false;
    adminTab.style.display = "none";
    setAuthStatus();
  }
}

async function requestCode() {
  setStatus("profile", "");
  authMessageEl.textContent = "";
  try {
    await api("/v1/auth/request", { method: "POST", body: { email: authEmailInput.value } });
    authMessageEl.textContent = "Code sent.";
  } catch (err) {
    authMessageEl.textContent = err.message;
  }
}

async function verifyCode() {
  authMessageEl.textContent = "";
  try {
    const res = await api("/v1/auth/verify", {
      method: "POST",
      body: { email: authEmailInput.value, code: authCodeInput.value },
    });
    authToken = res.token;
    localStorage.setItem("livenew_token", authToken);
    await handleAuthStatus();
    await loadProfile();
    await loadDay(dayDateInput.value);
    await loadWeek(weekDateInput.value);
  } catch (err) {
    authMessageEl.textContent = err.message;
  }
}

function logout() {
  authToken = "";
  localStorage.removeItem("livenew_token");
  isAdminUser = false;
  adminTab.style.display = "none";
  setAuthStatus();
}

async function renderAdminContent(items) {
  const container = document.getElementById("admin-content");
  container.innerHTML = "";
  if (!items.length) {
    container.textContent = "No items.";
    return;
  }
  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        <th>Title</th>
        <th>Priority</th>
        <th>Enabled</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${items
        .map(
          (item) => `
        <tr data-id="${item.id}">
          <td><input type="checkbox" data-select="${item.id}" ${adminState.selectedIds.has(item.id) ? "checked" : ""} /></td>
          <td>${item.title || item.id}</td>
          <td>${item.priority ?? "-"}</td>
          <td>${item.enabled === false ? "no" : "yes"}</td>
          <td><button data-edit="${item.id}">Edit</button></td>
        </tr>`
        )
        .join("")}
    </tbody>`;
  container.appendChild(table);

  container.querySelectorAll("input[data-select]").forEach((box) => {
    box.addEventListener("change", (event) => {
      const id = event.target.dataset.select;
      if (event.target.checked) adminState.selectedIds.add(id);
      else adminState.selectedIds.delete(id);
    });
  });

  container.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.edit;
      const item = adminState.items.find((entry) => entry.id === id);
      adminState.selectedItem = item || null;
      renderAdminEditor(item);
    });
  });
}

function renderAdminEditor(item) {
  const editor = document.getElementById("admin-edit");
  if (!item) {
    editor.innerHTML = "Select an item to edit.";
    return;
  }
  editor.innerHTML = `
    <label>Title <input type="text" id="edit-title" value="${item.title || ""}" /></label>
    <label>Enabled <select id="edit-enabled"><option value="true">true</option><option value="false">false</option></select></label>
    <label>Priority <input type="number" id="edit-priority" value="${item.priority ?? 0}" /></label>
    <label>Novelty group <input type="text" id="edit-novelty" value="${item.noveltyGroup || ""}" /></label>
    <label>Tags (comma) <input type="text" id="edit-tags" value="${(item.tags || []).join(", ")}" /></label>
    <label>Minutes <input type="number" id="edit-minutes" value="${item.minutes ?? ""}" /></label>
    <label>Steps (one per line) <textarea id="edit-steps" rows="3">${(item.steps || []).join("\n")}</textarea></label>
    <label>Priorities (one per line) <textarea id="edit-priorities" rows="3">${(item.priorities || []).join("\n")}</textarea></label>
  `;
  const enabledSelect = document.getElementById("edit-enabled");
  enabledSelect.value = item.enabled === false ? "false" : "true";
}

function collectAdminPatch() {
  return {
    title: document.getElementById("edit-title")?.value || undefined,
    enabled: document.getElementById("edit-enabled")?.value === "true",
    priority: Number(document.getElementById("edit-priority")?.value),
    noveltyGroup: document.getElementById("edit-novelty")?.value || "",
    tags: (document.getElementById("edit-tags")?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    minutes: document.getElementById("edit-minutes")?.value ? Number(document.getElementById("edit-minutes").value) : undefined,
    steps: (document.getElementById("edit-steps")?.value || "")
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean),
    priorities: (document.getElementById("edit-priorities")?.value || "")
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

async function loadAdminContent() {
  const kind = document.getElementById("admin-kind").value;
  setStatus("admin", "Loading...");
  try {
    const res = await api(`/v1/admin/content?kind=${kind}`);
    adminState.items = res.items || [];
    adminState.selectedItem = null;
    adminState.selectedIds.clear();
    await renderAdminContent(adminState.items);
    renderAdminEditor(null);
    setStatus("admin", "Loaded.", "success");
  } catch (err) {
    setStatus("admin", err.message, "error");
  }
}

async function saveAdminItem() {
  const item = adminState.selectedItem;
  if (!item) return;
  setStatus("admin", "Saving...");
  try {
    const patch = collectAdminPatch();
    await api(`/v1/admin/content/${item.kind || document.getElementById("admin-kind").value}/${item.id}`,
      { method: "PATCH", body: patch }
    );
    await loadAdminContent();
    setStatus("admin", "Saved.", "success");
  } catch (err) {
    setStatus("admin", err.message, "error");
  }
}

async function applyBulk(update) {
  const ids = Array.from(adminState.selectedIds);
  if (!ids.length) return;
  setStatus("admin", "Applying...", "");
  for (const id of ids) {
    const item = adminState.items.find((entry) => entry.id === id);
    if (!item) continue;
    await api(`/v1/admin/content/${item.kind}/${item.id}`, { method: "PATCH", body: update(item) });
  }
  adminState.selectedIds.clear();
  await loadAdminContent();
}

async function loadWorstItems() {
  const kind = document.getElementById("worst-kind").value;
  const table = document.getElementById("worst-table");
  table.textContent = "Loading...";
  try {
    const res = await api(`/v1/admin/reports/worst-items?kind=${kind}`);
    const rows = res.items || [];
    table.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Picked</th>
            <th>Completed</th>
            <th>Not relevant</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${row.item?.title || row.item?.id || "-"}</td>
              <td>${row.stats?.picked ?? 0}</td>
              <td>${row.stats?.completed ?? 0}</td>
              <td>${row.stats?.notRelevant ?? 0}</td>
              <td>${row.score != null ? row.score.toFixed(2) : "-"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  } catch (err) {
    table.textContent = err.message;
  }
}

function bindEvents() {
  document.getElementById("request-code").addEventListener("click", requestCode);
  document.getElementById("verify-code").addEventListener("click", verifyCode);
  document.getElementById("logout").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("load-day").addEventListener("click", () => loadDay(dayDateInput.value));
  document.getElementById("signal-buttons").addEventListener("click", async (event) => {
    const signal = event.target.dataset.signal;
    if (!signal) return;
    setStatus("day", "Applying signal...");
    try {
      const res = await api("/v1/signal", { method: "POST", body: { dateISO: dayDateInput.value, signal } });
      renderDay(res.day);
      setStatus("day", "Signal applied.", "success");
    } catch (err) {
      setStatus("day", err.message, "error");
    }
  });
  document.getElementById("bad-day").addEventListener("click", async () => {
    setStatus("day", "Applying bad day mode...");
    try {
      const res = await api("/v1/bad-day", { method: "POST", body: { dateISO: dayDateInput.value } });
      renderDay(res.day);
      setStatus("day", "Bad day mode applied.", "success");
    } catch (err) {
      setStatus("day", err.message, "error");
    }
  });

  document.getElementById("checkin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("checkin", "Saving check-in...");
    try {
      const res = await api("/v1/checkin", { method: "POST", body: { checkIn: collectCheckIn() } });
      if (res.day) renderDay(res.day);
      setStatus("checkin", "Check-in saved.", "success");
    } catch (err) {
      setStatus("checkin", err.message, "error");
    }
  });

  document.getElementById("completion-buttons").addEventListener("click", async (event) => {
    const part = event.target.dataset.part;
    if (!part) return;
    setStatus("completion", "Updating completion...");
    try {
      await api("/v1/complete", { method: "POST", body: { dateISO: dayDateInput.value, part } });
      setStatus("completion", "Updated.", "success");
    } catch (err) {
      setStatus("completion", err.message, "error");
    }
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
      setStatus("feedback", err.message, "error");
    }
  });

  document.getElementById("load-week").addEventListener("click", () => loadWeek(weekDateInput.value));
  document.getElementById("load-trends").addEventListener("click", () => loadTrends(document.getElementById("trends-days").value));

  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("profile", "Saving profile...");
    try {
      const res = await api("/v1/profile", { method: "POST", body: { userProfile: collectProfile() } });
      setStatus("profile", `Saved. Week starts ${res.weekPlan?.startDateISO || ""}.`, "success");
    } catch (err) {
      setStatus("profile", err.message, "error");
    }
  });

  document.getElementById("admin-load").addEventListener("click", loadAdminContent);
  document.getElementById("admin-save").addEventListener("click", saveAdminItem);
  document.getElementById("bulk-enable").addEventListener("click", () => applyBulk(() => ({ enabled: true })));
  document.getElementById("bulk-disable").addEventListener("click", () => applyBulk(() => ({ enabled: false })));
  document.getElementById("bulk-priority-up").addEventListener("click", () => applyBulk((item) => ({ priority: (item.priority || 0) + 1 })));
  document.getElementById("bulk-priority-down").addEventListener("click", () => applyBulk((item) => ({ priority: (item.priority || 0) - 1 })));
  document.getElementById("load-worst").addEventListener("click", loadWorstItems);
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

function initDates() {
  const today = isoToday();
  [dayDateInput, checkinDateInput, feedbackDateInput, weekDateInput].forEach((input) => {
    if (input) input.value = today;
  });
}

async function bootstrap() {
  initDates();
  bindEvents();
  await ensureCsrfToken();
  await handleAuthStatus();
  await loadDay(dayDateInput.value);
  await loadWeek(weekDateInput.value);
  await loadTrends(document.getElementById("trends-days").value);
  await loadProfile();
}

bootstrap();
