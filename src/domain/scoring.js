export function computeCortisolLoad(b, c) {
  const sleepPenalty = clamp((8 - b.sleepHours) * 10, 0, 30);
  const stressPenalty = clamp(b.perceivedStress * 5, 0, 50);
  const caffeinePenalty = clamp(b.caffeineCups * 6, 0, 24);
  const lateScreenPenalty = clamp((b.lateScreenMins / 15) * 2, 0, 16);
  const alcoholPenalty = clamp(b.alcoholNightsPerWeek * 3, 0, 21);
  const sunlightBonus = clamp((b.sunlightMinsPerDay / 10) * 2, 0, 10);
  const mealTimingPenalty = clamp((10 - b.mealTimingConsistency) * 1.5, 0, 13.5);
  const lateCaffeinePenalty = clamp(b.lateCaffeineDaysPerWeek * 2, 0, 14);
  const sleepRegularityPenalty = clamp((10 - b.sleepRegularity) * 2, 0, 18);

  const checkInPenalty = c
    ? clamp(c.stress * 3 + (10 - c.sleepQuality) * 2 + c.cravings * 1.5, 0, 45)
    : 0;

  const raw =
    sleepPenalty +
    stressPenalty +
    caffeinePenalty +
    lateScreenPenalty +
    alcoholPenalty +
    mealTimingPenalty +
    lateCaffeinePenalty +
    sleepRegularityPenalty +
    checkInPenalty -
    sunlightBonus;
  return clamp(raw, 0, 100);
}

export function loadBand(load) {
  if (load >= 70) return "high";
  if (load >= 40) return "medium";
  return "low";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

export function clamp0N(value, max) {
  const upper = Number.isFinite(max) ? max : 1;
  return clamp(Number(value) || 0, 0, upper);
}

export function computeStressScores(checkIn) {
  const stress = clamp0N(checkIn?.stress ?? 5, 10) / 10;
  const sleepQuality = clamp0N(checkIn?.sleepQuality ?? 6, 10) / 10;
  const energy = clamp0N(checkIn?.energy ?? 6, 10) / 10;
  const timeAvailable = clamp0N(checkIn?.timeAvailableMin ?? 10, 60) / 60;

  const load = clamp01((stress + (1 - sleepQuality) + (1 - energy)) / 3);
  const capacity = clamp01((timeAvailable + energy + sleepQuality) / 3);

  return { load, capacity };
}

export function computeLoadCapacity(checkIn) {
  const stress = clampInt(checkIn?.stress, 1, 10, 5);
  const sleep = clampInt(checkIn?.sleepQuality, 1, 10, 6);
  const energy = clampInt(checkIn?.energy, 1, 10, 6);
  const timeMin = clampInt(checkIn?.timeMin ?? checkIn?.timeAvailableMin, 5, 60, 10);

  const loadRaw = (stress + (10 - sleep) + (10 - energy)) / 3;
  const capacityRaw = (energy + sleep + (timeMin / 60) * 10) / 3;

  const load = clampInt(loadRaw * 10, 0, 100, 50);
  const capacity = clampInt(capacityRaw * 10, 0, 100, 50);

  return { load, capacity };
}
