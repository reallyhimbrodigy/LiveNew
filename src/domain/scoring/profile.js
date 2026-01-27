import { clamp } from "../utils/math.js";
import { computeStressLoad } from "./stressLoad.js";
import { computeCapacity } from "./capacity.js";
import { DEFAULT_PARAMETERS } from "../params.js";

export function bandLoad(x, thresholds = DEFAULT_PARAMETERS.profileThresholds) {
  if (x >= thresholds.loadBandHighMin) return "high";
  if (x >= thresholds.loadBandMediumMin) return "medium";
  return "low";
}

export function bandCapacity(x, thresholds = DEFAULT_PARAMETERS.profileThresholds) {
  if (x >= thresholds.capacityBandHighMin) return "high";
  if (x >= thresholds.capacityBandMediumMin) return "medium";
  return "low";
}

export function assignStressProfile({ user, dateISO, checkIn, params, profileOverride }) {
  const thresholds = params?.profileThresholds || DEFAULT_PARAMETERS.profileThresholds;
  const load = computeStressLoad(user, checkIn);
  const cap = computeCapacity(user, checkIn);

  const stressLoad = clamp(load.score, 0, 100);
  const capacity = clamp(cap.score, 0, 100);

  const loadBand = bandLoad(stressLoad, thresholds);
  const capacityBand = bandCapacity(capacity, thresholds);

  let profile = "Balanced";
  const drivers = [...load.drivers, ...cap.drivers];

  const sleepQ = checkIn ? checkIn.sleepQuality : 6;
  const stress = checkIn ? checkIn.stress : 5;
  const energy = checkIn ? checkIn.energy : 6;

  if (sleepQ <= thresholds.sleepPoorMax && loadBand !== "low") profile = "PoorSleep";
  else if (loadBand === "high" && capacityBand !== "high" && stress >= thresholds.stressHighMin) {
    profile = "WiredOverstimulated";
  } else if (capacityBand === "low" && energy <= thresholds.energyLowMax && loadBand !== "low") {
    profile = "DepletedBurnedOut";
  } else if (stress >= thresholds.stressAnxiousMin && sleepQ >= thresholds.sleepAnxiousMin && capacityBand !== "high") {
    profile = "RestlessAnxious";
  }
  else profile = "Balanced";

  if (typeof profileOverride === "string" && profileOverride.trim()) {
    profile = profileOverride.trim();
  }

  return {
    dateISO,
    stressLoad,
    capacity,
    loadBand,
    capacityBand,
    profile,
    drivers,
  };
}
