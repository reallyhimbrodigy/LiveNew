import { weekStartMonday, addDaysISO } from "../utils/date";
import { assignStressProfile } from "../scoring/profile";
import { defaultLibrary } from "../content/library";
import { applyConstraints } from "./constraints";

export function generateWeekPlan({ user, weekAnchorISO, checkInsByDate }) {
  const startDateISO = weekStartMonday(weekAnchorISO);
  const days = [];

  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(startDateISO, i);
    const checkIn = checkInsByDate ? checkInsByDate[dateISO] : undefined;

    const state = assignStressProfile({ user, dateISO, checkIn });
    let focus = focusFromProfile(state.profile, state.capacity);

    const rawTimeMin = checkIn ? checkIn.timeAvailableMin : 20;
    const isBusy = Array.isArray(user.busyDays) && user.busyDays.includes(dateISO);
    const timeMin = isBusy ? Math.min(rawTimeMin, 15) : rawTimeMin;

    const workout = pickWorkout({ focus, timeMin, checkIn });
    const nutrition = pickNutrition({ focus });
    const reset = pickReset({ focus, timeMin });
    const workoutWindow = pickWorkoutWindow(user);

    const rationale = [
      `Profile: ${state.profile}`,
      `Stress load: ${Math.round(state.stressLoad)}/100`,
      `Capacity: ${Math.round(state.capacity)}/100`,
      ...state.drivers.slice(0, 3),
    ];

    if (isBusy) rationale.push("Busy day -> shorter plan");

    const dayDraft = {
      dateISO,
      profile: state.profile,
      focus,
      workout,
      nutrition,
      reset,
      rationale,
      workoutWindow,
    };

    const day = applyConstraints({ user, checkIn, state, dayDraft });

    days.push(day);
  }

  return { startDateISO, days, version: 1 };
}

export function focusFromProfile(profile, capacity) {
  if (profile === "WiredOverstimulated" || profile === "PoorSleep") return "downshift";
  if (profile === "DepletedBurnedOut" || profile === "RestlessAnxious") return "stabilize";
  if (profile === "Balanced") return capacity >= 65 ? "rebuild" : "stabilize";
  return "stabilize";
}

export function pickWorkout({ focus, timeMin, checkIn }) {
  const lib = defaultLibrary.workouts;
  const tag = focus;

  const baseFilter = (w) => {
    if (timeMin != null && w.minutes > timeMin) return false;
    if (checkIn && w.minSleepQuality != null && checkIn.sleepQuality < w.minSleepQuality) return false;
    if (focus === "downshift" && w.intensityCost > 4) return false;
    return true;
  };

  let bucket = lib.filter((w) => w.tags.includes(tag)).filter(baseFilter);

  if (!bucket.length) {
    bucket = lib.filter(baseFilter);
  }

  if (!bucket.length) return lib[0];

  if (focus === "downshift") {
    return bucket.sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes)[0];
  }

  return bucket.sort((a, b) => {
    const da = timeMin != null ? timeMin - a.minutes : a.minutes;
    const db = timeMin != null ? timeMin - b.minutes : b.minutes;
    if (da !== db) return da - db;
    return a.intensityCost - b.intensityCost;
  })[0];
}

export function pickNutrition({ focus }) {
  const lib = defaultLibrary.nutrition;
  const matches = lib.filter((n) => n.tags.includes(focus));
  if (matches.length) {
    return matches.sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes)[0];
  }
  return lib[0];
}

export function pickReset({ focus, timeMin }) {
  const lib = defaultLibrary.resets;
  const tag = focus === "rebuild" ? "stabilize" : focus;

  const maxMinutes = Math.min(5, Math.max(2, Math.floor((timeMin || 20) / 10)));

  const bucket = lib
    .filter((r) => r.tags.includes(tag))
    .filter((r) => r.minutes <= maxMinutes)
    .sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes);

  return bucket[0] || lib[0];
}

export function pickWorkoutWindow(user) {
  const prefs = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
  if (prefs.includes("PM")) return "PM";
  if (prefs.length) return prefs[0];
  return "PM";
}
