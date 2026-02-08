import { apiGet, apiPost, getToken, setToken, setRefreshToken } from "./app.api.202602082129-cc53c70.js";
import { getAppState, setAppState } from "./app.state.202602082129-cc53c70.js";
import {
  initBaseUi,
  bindAuth,
  setAppErrorHandler,
  hideGateScreens,
  renderConsentScreen,
  renderOnboardScreen,
  showLoginScreen,
  showIncidentScreen,
  showErrorScreen,
  t,
} from "./app.core.202602082129-cc53c70.js";

let controllersModule = null;
async function loadControllers() {
  if (!controllersModule) {
    controllersModule = import("./controllers.202602082129-cc53c70.js");
  }
  return controllersModule;
}

function getErrorCode(err) {
  return err?.code || err?.payload?.error?.code || null;
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
  const mode = getAppState()?.envMode;
  return mode === "alpha" || mode === "prod";
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

function attachUnhandledHook() {
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
    handleAppError(err);
  });
  unhandledHookAttached = true;
}

function requestInit() {
  if (initInFlight) {
    pendingInit = true;
    return;
  }
  void initApp();
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

function handleAppError(err) {
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

async function routeUiState({ boot, page }) {
  const uiState = boot?.uiState || "login";
  hideGateScreens();
  setTodayNavEnabled(uiState === "home");

  if (page !== "home" && page !== "smoke" && uiState !== "home") {
    // Stay on the current page and render the appropriate gate screen.
  }

  if (page === "home" && uiState === "home") {
    window.location.assign("/day");
    return;
  }

  if (uiState === "login") {
    showLoginScreen();
    return;
  }

  if (uiState === "consent") {
    renderConsentScreen({
      requiredKeys: boot?.consent?.requiredKeys || boot?.consent?.required || null,
      requiredVersion: boot?.consent?.requiredVersion ?? null,
      onAccepted: async () => requestInit(),
      onError: handleAppError,
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
      onError: handleAppError,
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

export async function initApp({ page } = {}) {
  const resolvedPage = page || resolvePage();
  if (resolvedPage === "home") {
    return;
  }
  const protectedPages = new Set(["day", "week", "trends", "profile"]);
  if (protectedPages.has(resolvedPage) && !hasValidToken(getToken())) {
    window.location.assign("/login.html");
    return;
  }
  if (initInFlight) {
    pendingInit = true;
    return;
  }
  initInFlight = true;
  try {
    initBaseUi();
    attachUnhandledHook();
    setAppErrorHandler(handleAppError);
    const hasAuthUi = Boolean(document.querySelector("#auth-email") || document.querySelector("#auth-request"));
    if (hasAuthUi) {
      bindAuth({
        onAuthChange: requestInit,
        onError: handleAppError,
      });
    }

    if (resolvedPage === "smoke") {
      await runSmoke();
      return;
    }

    const { boot } = await runBootstrap();
    await routeUiState({ boot, page: resolvedPage });
  } catch (err) {
    handleAppError(err);
  } finally {
    initInFlight = false;
    if (pendingInit) {
      pendingInit = false;
      void initApp({ page: resolvedPage });
    }
  }
}

function shouldAutoBoot() {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !globalThis.__LIVENEW_NO_AUTOBOOT__
  );
}

const initialPage = resolvePage();
if (shouldAutoBoot()) {
  initApp({ page: initialPage }).catch((err) => handleAppError(err));
}

void apiPost;
