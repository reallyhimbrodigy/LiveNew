import { defaultLibrary } from "../content/library.js";

export function swapWorkoutForDownshift(day) {
  const workout =
    defaultLibrary.workouts.find((w) => w.tags.includes("downshift") && w.minutes <= day.workout.minutes) ||
    defaultLibrary.workouts.find((w) => w.tags.includes("downshift")) ||
    day.workout;

  const reset = defaultLibrary.resets.find((r) => r.tags.includes("downshift")) || day.reset;
  const nutrition = defaultLibrary.nutrition.find((n) => n.tags.includes("downshift")) || day.nutrition;

  return {
    ...day,
    focus: "downshift",
    workout,
    reset,
    nutrition,
    rationale: ["Adjusted: downshift now", ...day.rationale],
  };
}

export function shortenDayTo10Min(day) {
  const workout =
    defaultLibrary.workouts.filter((w) => w.minutes <= 10).sort((a, b) => a.minutes - b.minutes)[0] || day.workout;

  const reset =
    defaultLibrary.resets.filter((r) => r.minutes <= 3).sort((a, b) => a.minutes - b.minutes)[0] || day.reset;

  return {
    ...day,
    focus: day.focus === "rebuild" ? "stabilize" : day.focus,
    workout,
    reset,
    rationale: ["Adjusted: minimum-effective dose", ...day.rationale],
  };
}

export function upgradeDayIfReady(day) {
  if (day.focus === "downshift") return day;

  const workout =
    defaultLibrary.workouts.find(
      (w) => w.tags.includes("rebuild") && w.minutes >= Math.min(30, day.workout.minutes + 10)
    ) || day.workout;

  return {
    ...day,
    focus: "rebuild",
    workout,
    rationale: ["Adjusted: higher capacity today", ...day.rationale],
  };
}
