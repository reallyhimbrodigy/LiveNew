import { addDaysISO } from "../utils/date";
import { swapWorkoutForDownshift, shortenDayTo10Min, upgradeDayIfReady } from "./swap";

export function adaptPlan({ weekPlan, todayISO, checkIn, signal }) {
  const notes = [];
  let nextPlan = weekPlan;
  let changedDayISO;

  if (signal) {
    if (signal === "im_stressed" || signal === "wired" || signal === "anxious" || signal === "poor_sleep") {
      const res = applyToDay(nextPlan, todayISO, swapWorkoutForDownshift, "Downshift applied for today");
      nextPlan = res.weekPlan; changedDayISO = res.changedDayISO; notes.push(res.note);
    }

    if (signal === "im_exhausted" || signal === "i_have_10_min") {
      const res = applyToDay(nextPlan, todayISO, shortenDayTo10Min, "Shortened to minimum-effective dose");
      nextPlan = res.weekPlan; changedDayISO = res.changedDayISO; notes.push(res.note);
    }

    if (signal === "i_have_more_energy") {
      const res = applyToDay(nextPlan, todayISO, upgradeDayIfReady, "Upgraded plan intensity (still cortisol-safe)");
      nextPlan = res.weekPlan; changedDayISO = res.changedDayISO; notes.push(res.note);
    }
  }

  if (checkIn) {
    if (checkIn.stress >= 7 && checkIn.sleepQuality <= 5) {
      const tomorrowISO = addDaysISO(todayISO, 1);
      const res = applyToDay(nextPlan, tomorrowISO, swapWorkoutForDownshift, "Tomorrow downshifted due to high stress + poor sleep");
      nextPlan = res.weekPlan; changedDayISO = res.changedDayISO; notes.push(res.note);
    }
  }

  return { weekPlan: nextPlan, changedDayISO, notes };
}

function applyToDay(weekPlan, dateISO, fn, note) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, note: `No-op: ${note} (day not in current week)` };

  const nextDays = weekPlan.days.slice();
  nextDays[idx] = fn(nextDays[idx]);

  return { weekPlan: { ...weekPlan, days: nextDays }, changedDayISO: dateISO, note };
}
