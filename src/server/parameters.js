import { listParameters } from "../state/db.js";
import { DEFAULT_PARAMETERS } from "../domain/params.js";

let cache = { map: DEFAULT_PARAMETERS, versions: {}, ok: true, errors: [], loadedAt: 0 };
const TTL_MS = 10 * 1000;

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value) {
  return typeof value === "string";
}

function validateProfileThresholds(value) {
  if (!value || typeof value !== "object") return false;
  const fields = [
    "loadBandHighMin",
    "loadBandMediumMin",
    "capacityBandHighMin",
    "capacityBandMediumMin",
    "sleepPoorMax",
    "stressHighMin",
    "energyLowMax",
    "stressAnxiousMin",
    "sleepAnxiousMin",
    "capacityHighMin",
  ];
  return fields.every((field) => isNumber(value[field]));
}

function validateRecoveryDebtWeights(value) {
  if (!value || typeof value !== "object") return false;
  const fields = [
    "windowDays",
    "decayPerDay",
    "stressHighMin",
    "stressLowMax",
    "sleepLowMax",
    "sleepHighMin",
    "stressWeight",
    "sleepWeight",
    "goodDayBonus",
    "maxDebt",
  ];
  return fields.every((field) => isNumber(value[field]));
}

function validateTimeBuckets(value) {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value.allowed) || !value.allowed.length) return false;
  if (!value.allowed.every((item) => Number.isInteger(item))) return false;
  if (!isNumber(value.default)) return false;
  return true;
}

function validateFocusBiasRules(value) {
  if (!value || typeof value !== "object") return false;
  return ["rebuildCapacityMin", "recoveryDebtBiasLow", "recoveryDebtBiasHigh"].every((field) => isNumber(value[field]));
}

function validateContentPackWeights(value) {
  if (!value || typeof value !== "object") return false;
  const packs = ["calm_reset", "balanced_routine", "rebuild_strength"];
  return packs.every((pack) => {
    const packValue = value[pack];
    if (!packValue || typeof packValue !== "object") return false;
    const fields = ["workoutTagWeights", "resetTagWeights", "nutritionTagWeights"];
    return fields.every((field) => {
      const weights = packValue[field];
      if (!weights || typeof weights !== "object") return false;
      return Object.keys(weights).every((key) => isString(key) && isNumber(weights[key]));
    });
  });
}

function validateParamValue(key, value) {
  switch (key) {
    case "profileThresholds":
      return validateProfileThresholds(value);
    case "recoveryDebtWeights":
      return validateRecoveryDebtWeights(value);
    case "timeBuckets":
      return validateTimeBuckets(value);
    case "focusBiasRules":
      return validateFocusBiasRules(value);
    case "contentPackWeights":
      return validateContentPackWeights(value);
    default:
      return false;
  }
}

export function getDefaultParameters() {
  return JSON.parse(JSON.stringify(DEFAULT_PARAMETERS));
}

export async function getParameters() {
  const now = Date.now();
  if (cache.loadedAt && now - cache.loadedAt < TTL_MS) return cache;

  const rows = await listParameters();
  const map = getDefaultParameters();
  const versions = {};
  const errors = [];
  const seen = new Set();

  rows.forEach((row) => {
    const key = row.key;
    seen.add(key);
    if (validateParamValue(key, row.value)) {
      map[key] = row.value;
      versions[key] = row.version;
    } else {
      errors.push(`Invalid parameter: ${key}`);
      versions[key] = row.version;
    }
  });

  Object.keys(DEFAULT_PARAMETERS).forEach((key) => {
    if (!seen.has(key)) {
      versions[key] = versions[key] || 0;
    }
  });

  cache = {
    map,
    versions,
    ok: errors.length === 0,
    errors,
    loadedAt: now,
  };

  if (errors.length) {
    console.warn("LiveNew parameters invalid; using defaults:", errors.join("; "));
  }

  return cache;
}

export function resetParametersCache() {
  cache.loadedAt = 0;
}
