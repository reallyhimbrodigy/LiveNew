import { clamp01 } from "./scoring.js";

const PROFILE_LABELS = [
  "Wired/Overstimulated",
  "Depleted/Burned Out",
  "Restless/Anxious",
  "Poor Sleep",
  "Balanced",
];

function isNear(value, target, delta) {
  return Math.abs((Number(value) || 0) - target) <= delta;
}

function shouldHoldPriorProfile({ load, capacity, sleep, energy }) {
  return (
    isNear(load, 70, 2) ||
    isNear(capacity, 40, 2) ||
    isNear(load, 50, 3) ||
    isNear(capacity, 50, 3) ||
    isNear(sleep, 4, 1) ||
    isNear(energy, 5, 1)
  );
}

export function assignStressProfile({ load, capacity, checkIn }) {
  const stress = clamp01((Number(checkIn?.stress) || 5) / 10);
  const sleepQuality = clamp01((Number(checkIn?.sleepQuality) || 6) / 10);

  if (sleepQuality <= 0.35 && load >= 0.65) return "POOR_SLEEP";
  if (load >= 0.7 && capacity <= 0.35) return "DEPLETED";
  if (load >= 0.7 && capacity > 0.35) return "WIRED";
  if (load >= 0.45 && capacity <= 0.4 && stress >= 0.45) return "RESTLESS";
  return "BALANCED";
}

export function assignProfile({ load, capacity, sleep, energy, priorProfile }) {
  const sleepScore = Number.isFinite(Number(sleep)) ? Number(sleep) : 6;
  const energyScore = Number.isFinite(Number(energy)) ? Number(energy) : 6;
  const loadScore = Number.isFinite(Number(load)) ? Number(load) : 50;
  const capacityScore = Number.isFinite(Number(capacity)) ? Number(capacity) : 50;
  const resolvedPrior = PROFILE_LABELS.includes(priorProfile) ? priorProfile : null;
  if (resolvedPrior && shouldHoldPriorProfile({ load: loadScore, capacity: capacityScore, sleep: sleepScore, energy: energyScore })) {
    return resolvedPrior;
  }

  if (sleepScore <= 4 && loadScore >= 70) return "Poor Sleep";
  if (loadScore >= 70 && capacityScore <= 40) return "Depleted/Burned Out";
  if (loadScore >= 70 && capacityScore > 40) return "Wired/Overstimulated";
  if (loadScore >= 50 && capacityScore <= 50 && energyScore <= 5) return "Restless/Anxious";
  return "Balanced";
}

export { PROFILE_LABELS };
