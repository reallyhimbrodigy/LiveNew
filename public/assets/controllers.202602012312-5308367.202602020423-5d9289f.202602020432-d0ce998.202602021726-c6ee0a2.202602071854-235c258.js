import { getAppState, initDay, initWeek, initTrends, initProfile, initAdmin } from "./app.core.202602012312-5308367.js";

const BUILD_ID = "202602012312-5308367";
console.log("[LiveNew BUILD]", BUILD_ID);

async function loadCore() {
  return { getAppState, initDay, initWeek, initTrends, initProfile, initAdmin };
}

export function renderHome() {
  return null;
}

export async function renderDay(dateISO) {
  const { initDay } = await loadCore();
  return initDay({ initialDateISO: dateISO });
}

export async function renderWeek() {
  const { initWeek } = await loadCore();
  return initWeek();
}

export async function renderTrends() {
  const { initTrends } = await loadCore();
  return initTrends();
}

export async function renderProfile() {
  const { initProfile } = await loadCore();
  return initProfile();
}

export async function renderAdmin() {
  const { initAdmin } = await loadCore();
  return initAdmin();
}
