const PROFILE_LABELS = [
  "Wired/Overstimulated",
  "Depleted/Burned Out",
  "Restless/Anxious",
  "Poor Sleep",
  "Balanced",
];

function contractError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTodayContract(input) {
  if (!isObject(input)) {
    throw contractError("TODAY_CONTRACT_INVALID", "TodayContract must be an object");
  }
  const contract = { ...input };
  if (contract.ok !== true) {
    throw contractError("TODAY_CONTRACT_INVALID", "TodayContract.ok must be true");
  }
  const dateKey = contract.dateKey || contract.dateISO;
  if (!dateKey || typeof dateKey !== "string") {
    throw contractError("TODAY_CONTRACT_INVALID", "TodayContract.dateKey is required", { field: "dateKey" });
  }
  contract.dateKey = dateKey;
  contract.dateISO = dateKey;

  if (!PROFILE_LABELS.includes(contract.profile)) {
    throw contractError("TODAY_CONTRACT_INVALID", "TodayContract.profile is invalid", { profile: contract.profile });
  }

  if (!isObject(contract.reset)) {
    throw contractError("TODAY_CONTRACT_INVALID", "TodayContract.reset is required", { field: "reset" });
  }
  const durationSec = Number(contract.reset.durationSec ?? contract.reset.seconds);
  if (!Number.isFinite(durationSec) || durationSec < 120 || durationSec > 300) {
    throw contractError("TODAY_CONTRACT_INVALID", "Reset durationSec must be 120..300", { durationSec });
  }
  if (typeof contract.reset.id !== "string" || typeof contract.reset.title !== "string") {
    throw contractError("TODAY_CONTRACT_INVALID", "Reset must include id and title", { field: "reset" });
  }
  contract.reset = {
    ...contract.reset,
    durationSec,
    seconds: durationSec,
    steps: Array.isArray(contract.reset.steps) ? contract.reset.steps : [],
  };

  if (contract.movement == null) {
    contract.movement = null;
  } else if (!isObject(contract.movement)) {
    throw contractError("TODAY_CONTRACT_INVALID", "movement must be object or null", { field: "movement" });
  } else {
    if (typeof contract.movement.id !== "string" || typeof contract.movement.title !== "string") {
      throw contractError("TODAY_CONTRACT_INVALID", "movement must include id and title", { field: "movement" });
    }
    const durationMin = Number(contract.movement.durationMin ?? contract.movement.minutes);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      throw contractError("TODAY_CONTRACT_INVALID", "movement durationMin must be positive", { durationMin });
    }
    contract.movement = { ...contract.movement, durationMin, minutes: durationMin };
  }

  if (!isObject(contract.nutrition)) {
    throw contractError("TODAY_CONTRACT_INVALID", "nutrition is required", { field: "nutrition" });
  }
  if (typeof contract.nutrition.id !== "string" || typeof contract.nutrition.title !== "string") {
    throw contractError("TODAY_CONTRACT_INVALID", "nutrition must include id and title", { field: "nutrition" });
  }
  contract.nutrition = {
    ...contract.nutrition,
    bullets: Array.isArray(contract.nutrition.bullets) ? contract.nutrition.bullets : [],
  };

  if (!Array.isArray(contract.rationale)) {
    contract.rationale = Array.isArray(contract.rationale?.bullets) ? contract.rationale.bullets : [];
  }
  if (!contract.rationale.every((entry) => typeof entry === "string")) {
    throw contractError("TODAY_CONTRACT_INVALID", "rationale must be array of strings", { field: "rationale" });
  }

  if (!isObject(contract.meta)) contract.meta = {};
  if (!isObject(contract.meta.completed)) contract.meta.completed = {};
  if (typeof contract.meta.completed.reset !== "boolean") {
    contract.meta.completed.reset = false;
  }
  if (typeof contract.meta.inputHash !== "string") {
    throw contractError("TODAY_CONTRACT_INVALID", "meta.inputHash is required", { field: "meta.inputHash" });
  }
  if (!isObject(contract.scores)) {
    throw contractError("TODAY_CONTRACT_INVALID", "scores are required", { field: "scores" });
  }
  const load = Number(contract.scores.load);
  const capacity = Number(contract.scores.capacity);
  if (!Number.isFinite(load) || load < 0 || load > 100) {
    throw contractError("TODAY_CONTRACT_INVALID", "scores.load must be 0..100", { load });
  }
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) {
    throw contractError("TODAY_CONTRACT_INVALID", "scores.capacity must be 0..100", { capacity });
  }
  contract.scores = { load, capacity };

  return contract;
}

export function assertTodayContract(input) {
  return normalizeTodayContract(input);
}

export { PROFILE_LABELS };
