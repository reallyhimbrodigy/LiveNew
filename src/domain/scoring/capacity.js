import { clamp } from "../utils/math";

export function computeCapacity(user, checkIn, wearable) {
  const drivers = [];

  const energy = checkIn ? checkIn.energy * 8 : 50;
  if (checkIn && checkIn.energy <= 4) drivers.push("Low energy today");

  const sleepQuality = checkIn ? checkIn.sleepQuality * 6 : 40;
  if (checkIn && checkIn.sleepQuality >= 7) drivers.push("Sleep quality supports training");

  const time = checkIn ? checkIn.timeAvailableMin : 20;
  const timeScore = clamp(time * 1.2, 6, 72);
  if (checkIn && time <= 10) drivers.push("Limited time available");

  const sunlight = clamp((user.sunlightMinutesPerDay / 10) * 3, 0, 18);
  const sleepRegularity = clamp(user.sleepRegularity * 4, 4, 40);

  let wearableScore = 0;
  if (wearable && wearable.sleepMinutes != null) {
    wearableScore += clamp((wearable.sleepMinutes - 360) * 0.05, 0, 15);
    if (wearableScore >= 8) drivers.push("Wearable sleep duration supports capacity");
  }
  if (wearable && wearable.hrvMs != null) {
    wearableScore += clamp((wearable.hrvMs - 35) * 0.4, 0, 20);
  }

  const lateScreenPenalty = clamp((user.lateScreenMinutesPerNight / 30) * 6, 0, 18);

  const raw = energy + sleepQuality + timeScore + sunlight + sleepRegularity + wearableScore - lateScreenPenalty;
  const score = clamp(raw / 3, 0, 100);

  return { score, drivers };
}
