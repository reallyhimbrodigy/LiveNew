import { getAppState, initDay, initWeek, initTrends, initProfile, initAdmin } from "./app.core.js";

function consentOk() {
  const state = getAppState();
  return Boolean(state?.consentComplete);
}

export function loadHome() {
  if (!consentOk()) return;
  initDay();
}

export function loadDay() {
  if (!consentOk()) return;
  initDay();
}

export function loadWeek() {
  if (!consentOk()) return;
  initWeek();
}

export function loadTrends() {
  initTrends();
}

export function loadProfile() {
  initProfile();
}

export function loadAdmin() {
  initAdmin();
}
