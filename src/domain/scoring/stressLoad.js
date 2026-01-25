import { clamp } from "../utils/math";

export function computeStressLoad(user, checkIn) {
  const drivers = [];

  const screenPenalty = clamp((user.lateScreenMinutesPerNight / 15) * 2, 0, 16);
  if (screenPenalty >= 8) drivers.push("High late-night screen exposure");

  const alcoholPenalty = clamp(user.alcoholNightsPerWeek * 3, 0, 21);
  if (alcoholPenalty >= 9) drivers.push("Alcohol frequency elevates recovery load");

  const lateCafPenalty = clamp(user.lateCaffeineDaysPerWeek * 2, 0, 14);
  if (lateCafPenalty >= 6) drivers.push("Late caffeine likely disrupts sleep pressure");

  const irregularSleepPenalty = clamp((10 - user.sleepRegularity) * 2, 0, 18);
  if (irregularSleepPenalty >= 8) drivers.push("Irregular sleep timing");

  const mealTimingPenalty = clamp((10 - user.mealTimingConsistency) * 1.5, 0, 14);
  if (mealTimingPenalty >= 7) drivers.push("Inconsistent meal timing");

  const sunlightBonus = clamp((user.sunlightMinutesPerDay / 10) * 2, 0, 10);
  if (sunlightBonus >= 6) drivers.push("Good daylight exposure supports rhythm");

  const stressPenalty = checkIn ? clamp(checkIn.stress * 4, 0, 40) : 0;
  if (checkIn && checkIn.stress >= 7) drivers.push("High perceived stress today");

  const sleepQualPenalty = checkIn ? clamp((10 - checkIn.sleepQuality) * 3, 0, 27) : 0;
  if (checkIn && checkIn.sleepQuality <= 5) drivers.push("Low sleep quality");

  const raw =
    screenPenalty +
    alcoholPenalty +
    lateCafPenalty +
    irregularSleepPenalty +
    mealTimingPenalty +
    stressPenalty +
    sleepQualPenalty -
    sunlightBonus;

  const score = clamp(raw, 0, 100);
  return { score, drivers };
}
