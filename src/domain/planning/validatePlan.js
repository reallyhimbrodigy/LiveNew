function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validateDayPlan(dayPlan, ctx = {}) {
  const reasons = [];
  if (!dayPlan) {
    reasons.push({ key: "missing_day", message: "Day plan missing" });
    return { ok: false, reasons };
  }

  const checkIn = ctx.checkIn || null;
  const safetyLevel = dayPlan?.safety?.level || "ok";
  const workoutMinutes = dayPlan.workout ? toNumber(dayPlan.workout.minutes) || 0 : 0;
  const resetMinutes = toNumber(dayPlan.reset?.minutes) || 0;
  const totalMinutes = workoutMinutes + resetMinutes;
  const timeAvailableMin = toNumber(checkIn?.timeAvailableMin ?? ctx.timeAvailableMin);

  const safetyBlock = safetyLevel === "block" || checkIn?.panic || checkIn?.illness || checkIn?.fever;
  if (safetyBlock && dayPlan.workout !== null) {
    reasons.push({ key: "safety_block", message: "Workout must be blocked for safety signals" });
  }

  const sleepQuality = toNumber(checkIn?.sleepQuality);
  if (sleepQuality != null && sleepQuality <= 5 && (toNumber(dayPlan.workout?.intensityCost) || 0) > 4) {
    reasons.push({ key: "sleep_constraint", message: "Workout intensity too high for poor sleep" });
  }

  if (timeAvailableMin != null && totalMinutes > timeAvailableMin) {
    reasons.push({ key: "time_cap", message: "Plan exceeds available time" });
  }

  return { ok: reasons.length === 0, reasons };
}

