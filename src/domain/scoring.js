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
