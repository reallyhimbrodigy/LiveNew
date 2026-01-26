import { DEFAULT_PARAMETERS } from "../params.js";

export function computeRecoveryDebt(checkInsByDate, dateISO, params) {
  if (!checkInsByDate) return 0;
  const weights = params?.recoveryDebtWeights || DEFAULT_PARAMETERS.recoveryDebtWeights;
  const dates = Object.keys(checkInsByDate)
    .filter((d) => d <= dateISO)
    .sort();
  const recent = dates.slice(-weights.windowDays);
  let debt = 0;
  recent.forEach((d) => {
    debt = Math.max(0, debt - weights.decayPerDay);
    const checkIn = checkInsByDate[d];
    if (!checkIn) return;
    const stress = Number(checkIn.stress || 5);
    const sleep = Number(checkIn.sleepQuality || 6);
    if (stress >= weights.stressHighMin) debt += (stress - (weights.stressHighMin - 1)) * weights.stressWeight;
    if (sleep <= weights.sleepLowMax) debt += (weights.sleepLowMax + 1 - sleep) * weights.sleepWeight;
    if (stress <= weights.stressLowMax && sleep >= weights.sleepHighMin) {
      debt = Math.max(0, debt - weights.goodDayBonus);
    }
  });
  return Math.min(weights.maxDebt, Math.round(Math.max(0, debt)));
}
