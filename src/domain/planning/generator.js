import { weekStartMonday, addDaysISO } from "../utils/date";
import { assignStressProfile } from "../scoring/profile";
import { defaultLibrary } from "../content/library";

export function generateWeekPlan({ user, weekAnchorISO, checkInsByDate, wearablesByDate }) {
  const startDateISO = weekStartMonday(weekAnchorISO);
  const days = [];

  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(startDateISO, i);
    const checkIn = checkInsByDate ? checkInsByDate[dateISO] : undefined;
    const wearable = wearablesByDate ? wearablesByDate[dateISO] : undefined;

    const state = assignStressProfile({ user, dateISO, checkIn, wearable });
    const focus = focusFromProfile(state.profile, state.capacity);

    const timeMin = checkIn ? checkIn.timeAvailableMin : 20;

    const workout = pickWorkout(focus, timeMin);
    const nutrition = pickNutrition(focus);
    const reset = pickReset(focus, timeMin);

    const rationale = [
      `Profile: ${state.profile}`,
      `Stress load: ${Math.round(state.stressLoad)}/100`,
      `Capacity: ${Math.round(state.capacity)}/100`,
      ...state.drivers.slice(0, 3),
    ];

    days.push({
      dateISO,
      profile: state.profile,
      focus,
      workout,
      nutrition,
      reset,
      rationale,
    });
  }

  return { startDateISO, days, version: 1 };
}

function focusFromProfile(profile, capacity) {
  if (profile === "WiredOverstimulated" || profile === "PoorSleep") return "downshift";
  if (profile === "DepletedBurnedOut" || profile === "RestlessAnxious") return "stabilize";
  if (profile === "Balanced") return capacity >= 65 ? "rebuild" : "stabilize";
  return "stabilize";
}

function pickWorkout(focus, timeMin) {
  const lib = defaultLibrary.workouts;
  const tag = focus;

  const bucket = lib
    .filter((w) => w.tags.includes(tag))
    .filter((w) => w.minutes <= timeMin)
    .sort((a, b) => a.minutes - b.minutes);

  return bucket[0] || lib[0];
}

function pickNutrition(focus) {
  const lib = defaultLibrary.nutrition;
  const pick = lib.find((n) => n.tags.includes(focus));
  return pick || lib[0];
}

function pickReset(focus, timeMin) {
  const lib = defaultLibrary.resets;
  const tag = focus === "rebuild" ? "stabilize" : focus;

  const maxMinutes = Math.min(5, Math.max(2, Math.floor(timeMin / 10)));

  const pick = lib
    .filter((r) => r.tags.includes(tag))
    .filter((r) => r.minutes <= maxMinutes)
    .sort((a, b) => a.minutes - b.minutes)[0];

  return pick || lib[0];
}
