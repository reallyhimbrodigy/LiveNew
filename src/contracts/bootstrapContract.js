const UI_STATES = ["login", "consent", "onboard", "home"];

function contractError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function assertBootstrapContract(input) {
  if (!isObject(input)) {
    throw contractError("BOOTSTRAP_CONTRACT_INVALID", "Bootstrap must be an object");
  }
  if (!UI_STATES.includes(input.uiState)) {
    throw contractError("BOOTSTRAP_CONTRACT_INVALID", "uiState invalid", { uiState: input.uiState });
  }
  if (!isObject(input.auth) || typeof input.auth.isAuthenticated !== "boolean") {
    throw contractError("BOOTSTRAP_CONTRACT_INVALID", "auth.isAuthenticated required", { field: "auth.isAuthenticated" });
  }
  if (!isObject(input.consent)) {
    throw contractError("BOOTSTRAP_CONTRACT_INVALID", "consent required", { field: "consent" });
  }
  if (!isObject(input.profile)) {
    throw contractError("BOOTSTRAP_CONTRACT_INVALID", "profile required", { field: "profile" });
  }
  return input;
}

export { UI_STATES };
