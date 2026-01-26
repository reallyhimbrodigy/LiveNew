export function evaluateSafety({ checkIn, stressState }) {
  const reasons = [];
  if (!checkIn) return { level: "ok", reasons };
  const stress = Number(checkIn.stress || 5);
  const sleep = Number(checkIn.sleepQuality || 6);
  const panic = Boolean(checkIn.panic);
  const illness = Boolean(checkIn.illness);
  const fever = Boolean(checkIn.fever);
  const injury = Boolean(checkIn.injury);

  if (panic) reasons.push("panic");
  if (illness) reasons.push("illness");
  if (fever) reasons.push("fever");
  if (injury) reasons.push("injury");
  if (sleep <= 2) reasons.push("very_low_sleep");

  let level = "ok";
  if (panic || illness || fever) {
    level = "block";
  } else if (sleep <= 2 && stress >= 7) {
    level = "block";
  } else if (injury || sleep <= 2) {
    level = "caution";
  }

  return { level, reasons };
}
