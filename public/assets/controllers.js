const BUILD_ID = "202602012055";

console.log("[LiveNew BUILD]", BUILD_ID);

const coreMod = await import("./app.core.js");
if (!coreMod || typeof coreMod.getAppState !== "function") {
  throw new Error(
    `[LiveNew] app.core.js missing getAppState export. BUILD_ID=${BUILD_ID}. ` +
      "This indicates stale/partial deploy or wrong static root."
  );
}
const { getAppState } = coreMod;

let corePromise = Promise.resolve(coreMod);
async function loadCore() {
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
