import { initDay, initWeek, initTrends, initProfile, initAdmin } from "./app.core.js";

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
