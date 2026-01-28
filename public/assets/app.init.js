import { ensureCsrf } from "./app.api.js";
import {
  initBaseUi,
  bindAuth,
  updateAdminVisibility,
  bootstrapApp,
  getAppState,
  routeError,
  setupConsentGate,
} from "./app.core.js";
import { loadHome, loadWeek, loadTrends, loadProfile, loadAdmin } from "./controllers.js";

function isProdLike() {
  const mode = getAppState()?.envMode;
  return mode === "alpha" || mode === "prod";
}

let unhandledHookAttached = false;

function handleUnhandledRejection(event) {
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
}

async function renderConsentFlow({ page }) {
  if (page === "day" || page === "week") {
    const consentGate = setupConsentGate(() => initApp({ page }));
    consentGate.show();
    return;
  }
  window.location.href = "/day";
}

async function renderOnboardFlow({ page }) {
  if (page === "profile") {
    loadProfile();
    return;
  }
  window.location.href = "/profile";
}

export async function initApp({ page }) {
  await ensureCsrf();
  initBaseUi();
  if (!unhandledHookAttached) {
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    unhandledHookAttached = true;
  }
  bindAuth();
  const state = await bootstrapApp();
  await updateAdminVisibility();
  const uiState = state?.uiState || "login";

  if (uiState === "login") {
    routeError({ code: "auth_required" });
    return;
  }
  if (uiState === "consent") {
    await renderConsentFlow({ page });
    return;
  }
  if (uiState === "onboard") {
    await renderOnboardFlow({ page });
    return;
  }

  if (page === "home") {
    window.location.href = "/day";
    return;
  }

  if (page === "day") loadHome();
  if (page === "week") loadWeek();
  if (page === "trends") loadTrends();
  if (page === "profile") loadProfile();
  if (page === "admin") loadAdmin();
}

const page = document.body.dataset.page;
initApp({ page }).catch((err) => handleUnhandledRejection({ reason: err, preventDefault() {} }));
