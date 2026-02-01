const BUILD_ID = "__BUILD_ID__";
console.log("[LiveNew BUILD]", BUILD_ID);

const core = await import("./app.core.js");
if (!core || typeof core.getAppState !== "function") {
  const keys = core ? Object.keys(core).sort().join(", ") : "null";
  throw new Error(`[LiveNew] app.core missing getAppState. exports=[${keys}]`);
}
const { getAppState, initDay, initWeek, initTrends, initProfile, initAdmin } = core;

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
