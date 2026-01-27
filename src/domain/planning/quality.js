import { isoToday, addDaysISO } from "../utils/date.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dateISOWithinDays(dateISO, days) {
  if (!dateISO) return false;
  const today = isoToday();
  const min = addDaysISO(today, -days);
  return dateISO >= min && dateISO <= today;
}

function tagWeightScore(item, tagWeights) {
  if (!item || !tagWeights || !item.tags) return 0;
  let best = 0;
  item.tags.forEach((tag) => {
    const weight = Number(tagWeights[tag] || 0);
    if (weight > best) best = weight;
  });
  return best;
}

export function computeConfidence({ checkIn, stressState }) {
  let score = 0.35;
  if (checkIn) {
    score = 0.5;
    if (checkIn.timeAvailableMin != null) score += 0.15;
    if (checkIn.sleepQuality != null) score += 0.15;
    if (checkIn.stress != null) score += 0.1;
    if (checkIn.energy != null) score += 0.1;
  }
  if (stressState && stressState.loadBand === "high") score -= 0.05;
  if (checkIn && Number(checkIn.stress || 0) >= 8 && Number(checkIn.sleepQuality || 10) <= 3) score -= 0.1;
  return clamp(score, 0, 1);
}

export function computeRelevance({ dayPlan, recentFeedback, completionsByDate, packWeights }) {
  let score = 0.6;
  const pack = packWeights || {};
  const workoutBoost = tagWeightScore(dayPlan?.workout, pack.workoutTagWeights);
  const resetBoost = tagWeightScore(dayPlan?.reset, pack.resetTagWeights);
  const nutritionBoost = tagWeightScore(dayPlan?.nutrition, pack.nutritionTagWeights);
  const avgBoost = (workoutBoost + resetBoost + nutritionBoost) / 3;
  score += clamp(avgBoost / 6, -0.1, 0.2);

  const recentNotRelevant = (recentFeedback || []).some((entry) => entry?.reason === "not_relevant" && dateISOWithinDays(entry.dateISO, 14));
  if (recentNotRelevant) score -= 0.15;

  if (completionsByDate && dayPlan?.workout?.minutes) {
    let total = 0;
    let completed = 0;
    const today = isoToday();
    for (let i = 1; i <= 7; i += 1) {
      const dateISO = addDaysISO(today, -i);
      const parts = completionsByDate[dateISO];
      if (!parts) continue;
      total += 1;
      if (parts.workout) completed += 1;
    }
    if (total >= 3) {
      const rate = completed / total;
      if (rate < 0.3 && dayPlan.workout.minutes >= 20) score -= 0.1;
    }
  }

  return clamp(score, 0, 1);
}
