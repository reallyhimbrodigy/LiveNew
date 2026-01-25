import { clamp } from "../utils/math";
import { computeStressLoad } from "./stressLoad";
import { computeCapacity } from "./capacity";

export function bandLoad(x) {
  if (x >= 70) return "high";
  if (x >= 40) return "medium";
  return "low";
}

export function bandCapacity(x) {
  if (x >= 70) return "high";
  if (x >= 40) return "medium";
  return "low";
}

export function assignStressProfile({ user, dateISO, checkIn }) {
  const load = computeStressLoad(user, checkIn);
  const cap = computeCapacity(user, checkIn);

  const stressLoad = clamp(load.score, 0, 100);
  const capacity = clamp(cap.score, 0, 100);

  const loadBand = bandLoad(stressLoad);
  const capacityBand = bandCapacity(capacity);

  let profile = "Balanced";
  const drivers = [...load.drivers, ...cap.drivers];

  const sleepQ = checkIn ? checkIn.sleepQuality : 6;
  const stress = checkIn ? checkIn.stress : 5;
  const energy = checkIn ? checkIn.energy : 6;

  if (sleepQ <= 4 && loadBand !== "low") profile = "PoorSleep";
  else if (loadBand === "high" && capacityBand !== "high" && stress >= 7) profile = "WiredOverstimulated";
  else if (capacityBand === "low" && energy <= 4 && loadBand !== "low") profile = "DepletedBurnedOut";
  else if (stress >= 7 && sleepQ >= 5 && capacityBand !== "high") profile = "RestlessAnxious";
  else profile = "Balanced";

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
