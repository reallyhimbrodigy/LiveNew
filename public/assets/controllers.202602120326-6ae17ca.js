import * as Core from "./app.core.202602120326-6ae17ca.js";

const BUILD_ID = "202602120326-6ae17ca";
console.log("[LiveNew BUILD]", BUILD_ID);

const getAppState = Core.getAppState;
if (typeof getAppState !== "function") {
  const keys = Object.keys(Core).sort().join(", ");
  throw new Error(
    `[LiveNew] BUILD_INTEGRITY_FAILURE: app.core missing export getAppState. exports=[${keys}]`
  );
}
const { initDay, initWeek, initTrends, initProfile } = Core;

async function loadCore() {
  return { getAppState, initDay, initWeek, initTrends, initProfile };
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
