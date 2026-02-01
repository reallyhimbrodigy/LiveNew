import { initDay, initWeek, initTrends, initProfile, initAdmin, BUILD_ID } from "./app.core.js";

console.log("[LiveNew BUILD]", BUILD_ID);

export function renderHome() {
  return null;
}

export function renderDay(dateISO) {
  return initDay({ initialDateISO: dateISO });
}

export function renderWeek() {
  return initWeek();
}

export function renderTrends() {
  return initTrends();
}

export function renderProfile() {
  return initProfile();
}

export function renderAdmin() {
  return initAdmin();
}
