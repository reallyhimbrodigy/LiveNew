const ROOT = globalThis;
const STATE = ROOT.__APP_STATE || (ROOT.__APP_STATE = {});

export function getAppState() {
  return ROOT.__APP_STATE;
}

export function setAppState(patch) {
  Object.assign(ROOT.__APP_STATE, patch || {});
  return ROOT.__APP_STATE;
}

export function resetAppState() {
  ROOT.__APP_STATE = {};
  return ROOT.__APP_STATE;
}

void STATE;
