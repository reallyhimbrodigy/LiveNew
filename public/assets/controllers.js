import { initDay, initWeek, initTrends, initProfile, initAdmin } from "./app.core.js";

export function renderHome() {
  const page = document.body?.dataset?.page || "day";
  if (page === "week") return initWeek();
  if (page === "trends") return initTrends();
  if (page === "profile") return initProfile();
  if (page === "admin") return initAdmin();
  return initDay();
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
