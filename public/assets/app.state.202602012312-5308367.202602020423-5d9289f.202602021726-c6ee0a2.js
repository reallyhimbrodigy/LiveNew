const STATE = window.__APP_STATE || (window.__APP_STATE = {});

export function getAppState() {
  return window.__APP_STATE;
}

export function setAppState(patch) {
  Object.assign(window.__APP_STATE, patch || {});
  return window.__APP_STATE;
}

export function resetAppState() {
  window.__APP_STATE = {};
  return window.__APP_STATE;
}

void STATE;
