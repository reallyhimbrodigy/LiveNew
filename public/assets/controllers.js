import { APP_CORE_SPEC, BUILD_ID } from "./build.js";

console.log("[LiveNew BUILD]", BUILD_ID);

let corePromise = null;
async function loadCore() {
  if (!corePromise) {
    corePromise = import(APP_CORE_SPEC);
  }
  return corePromise;
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
