import { assignStressProfile } from "../scoring/profile";
import { defaultLibrary } from "../content/library";
import { applyConstraints } from "./constraints";

export function buildDayPlan({
  user,
  dateISO,
  checkIn,
  checkInsByDate,
  weekContext,
  overrides,
  qualityRules,
}) {
  void checkInsByDate;
  const ctx = weekContext || {};
  const rules = qualityRules || { avoidNoveltyWindowDays: 2 };
  const ov = overrides || {};

  const stressState = assignStressProfile({ user, dateISO, checkIn });

  let focus = focusFromProfile(stressState.profile, stressState.capacity);

  if (ov.focusBias) {
    if (ov.focusBias === "rebuild" && stressState.loadBand === "high") {
      focus = "stabilize";
    } else {
      focus = ov.focusBias;
    }
  }

  if (ov.forceBadDayMode) {
    focus = "downshift";
  }

  let timeMin = checkIn ? checkIn.timeAvailableMin : 20;
  if (ov.timeOverrideMin != null) timeMin = ov.timeOverrideMin;

  const busyDays = new Set([...(user.busyDays || []), ...((ctx.busyDays || []))]);
  const isBusy = busyDays.has(dateISO);
  if (isBusy) timeMin = Math.min(timeMin, 15);

  if (ov.forceBadDayMode) timeMin = Math.min(timeMin, 10);

  const baseCap = focus === "downshift" ? 4 : 10;
  let intensityCap = baseCap;
  if (ov.intensityCap != null) intensityCap = Math.min(intensityCap, ov.intensityCap);
  if (ov.forceBadDayMode) intensityCap = Math.min(intensityCap, 2);

  const avoidGroups = rules.avoidNoveltyWindowDays > 0 ? ctx.recentNoveltyGroups || [] : [];

  let workout = pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups });
  let nutrition = pickNutrition({ focus, avoidGroups, forceBadDayMode: ov.forceBadDayMode });
  let reset = pickReset({ focus, timeMin, avoidGroups, forceBadDayMode: ov.forceBadDayMode });
  const workoutWindow = pickWorkoutWindow(user);

  const rationale = [
    `Profile: ${stressState.profile}`,
    `Focus: ${focus}`,
    ...stressState.drivers.slice(0, 2),
  ];

  if (isBusy) rationale.push("Busy day -> shorter plan");
  if (ov.forceBadDayMode) rationale.push("Adjusted: bad day mode");
  if (ov.focusBias && !ov.forceBadDayMode) rationale.push("Adjusted: focus bias");
  if (ov.timeOverrideMin != null && !ov.forceBadDayMode) rationale.push("Adjusted: time override");
  if (ov.intensityCap != null && !ov.forceBadDayMode) rationale.push("Adjusted: intensity cap");

  let dayDraft = {
    dateISO,
    profile: stressState.profile,
    focus,
    workout,
    nutrition,
    reset,
    rationale,
    workoutWindow,
    selectedNoveltyGroups: {
      workout: workout.noveltyGroup,
      nutrition: nutrition.noveltyGroup,
      reset: reset.noveltyGroup,
    },
  };

  dayDraft = applyConstraints({ user, checkIn, state: stressState, dayDraft });

  let finalIntensityCap = intensityCap;
  if (dayDraft.focus === "downshift") finalIntensityCap = Math.min(finalIntensityCap, 4);

  if (ov.forceBadDayMode) {
    dayDraft.focus = "downshift";
    dayDraft.workout = enforceWorkoutCap(dayDraft.workout, { focus: "downshift", timeMin, checkIn, intensityCap: finalIntensityCap, avoidGroups });
    dayDraft.reset = enforceBadDayReset(dayDraft.reset);
    dayDraft.nutrition = enforceBadDayNutrition(dayDraft.nutrition);
  } else if (dayDraft.workout.intensityCost > finalIntensityCap) {
    dayDraft.workout = pickWorkout({ focus: dayDraft.focus, timeMin, checkIn, intensityCap: finalIntensityCap, avoidGroups });
  }

  dayDraft.selectedNoveltyGroups = {
    workout: dayDraft.workout.noveltyGroup,
    nutrition: dayDraft.nutrition.noveltyGroup,
    reset: dayDraft.reset.noveltyGroup,
  };

  const finalRationale = dayDraft.rationale ? dayDraft.rationale.slice() : [];
  finalRationale[0] = `Profile: ${stressState.profile}`;
  finalRationale[1] = `Focus: ${dayDraft.focus}`;
  dayDraft.rationale = finalRationale;

  return { dayPlan: dayDraft, stressState };
}

function focusFromProfile(profile, capacity) {
  if (profile === "WiredOverstimulated" || profile === "PoorSleep") return "downshift";
  if (profile === "DepletedBurnedOut" || profile === "RestlessAnxious") return "stabilize";
  if (profile === "Balanced") return capacity >= 65 ? "rebuild" : "stabilize";
  return "stabilize";
}

function pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups }) {
  const lib = defaultLibrary.workouts;
  const baseFilter = (w) => {
    if (timeMin != null && w.minutes > timeMin) return false;
    if (checkIn && w.minSleepQuality != null && checkIn.sleepQuality < w.minSleepQuality) return false;
    if (w.intensityCost > intensityCap) return false;
    return true;
  };

  let candidates = lib.filter((w) => w.tags.includes(focus)).filter(baseFilter);
  if (!candidates.length) candidates = lib.filter(baseFilter);

  candidates = applyNoveltyFilter(candidates, avoidGroups);

  if (!candidates.length) return lib[0];

  return candidates.sort((a, b) => workoutSort(a, b, { focus, timeMin }))[0];
}

function pickNutrition({ focus, avoidGroups, forceBadDayMode }) {
  const lib = defaultLibrary.nutrition;
  let candidates;

  if (forceBadDayMode) {
    candidates = lib.filter((n) => n.tags.includes("sleep") || n.tags.includes("downshift"));
  } else {
    candidates = lib.filter((n) => n.tags.includes(focus));
  }

  if (!candidates.length) candidates = lib.slice();

  candidates = applyNoveltyFilter(candidates, avoidGroups);
  if (!candidates.length) return lib[0];

  return candidates.sort(commonSort)[0];
}

function pickReset({ focus, timeMin, avoidGroups, forceBadDayMode }) {
  const lib = defaultLibrary.resets;
  const tag = focus === "rebuild" ? "stabilize" : focus;
  const maxMinutes = forceBadDayMode
    ? 3
    : Math.min(5, Math.max(2, Math.floor((timeMin || 20) / 10)));

  let candidates = lib
    .filter((r) => r.tags.includes(tag))
    .filter((r) => r.minutes <= maxMinutes);

  if (!candidates.length) candidates = lib.filter((r) => r.minutes <= maxMinutes);

  candidates = applyNoveltyFilter(candidates, avoidGroups);
  if (!candidates.length) return lib[0];

  return candidates.sort(commonSort)[0];
}

function pickWorkoutWindow(user) {
  const prefs = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
  if (prefs.includes("PM")) return "PM";
  if (prefs.length) return prefs[0];
  return "PM";
}

function applyNoveltyFilter(items, avoidGroups) {
  if (!avoidGroups || !avoidGroups.length) return items;
  const filtered = items.filter((item) => !avoidGroups.includes(item.noveltyGroup));
  return filtered.length ? filtered : items;
}

function workoutSort(a, b, { focus, timeMin }) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (focus === "downshift") {
    if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
    if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    return a.id.localeCompare(b.id);
  }
  const da = timeMin != null ? timeMin - a.minutes : a.minutes;
  const db = timeMin != null ? timeMin - b.minutes : b.minutes;
  if (da !== db) return da - db;
  if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
  return a.id.localeCompare(b.id);
}

function commonSort(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  return a.id.localeCompare(b.id);
}

function enforceBadDayReset(current) {
  if (current.minutes <= 3 && current.tags.includes("downshift")) return current;
  const candidates = defaultLibrary.resets
    .filter((r) => r.minutes <= 3)
    .filter((r) => r.tags.includes("downshift"))
    .sort(commonSort);
  return candidates[0] || current;
}

function enforceBadDayNutrition(current) {
  let next = current;
  if (!(current.tags.includes("sleep") || current.tags.includes("downshift"))) {
    const candidates = defaultLibrary.nutrition
      .filter((n) => n.tags.includes("sleep") || n.tags.includes("downshift"))
      .sort(commonSort);
    next = candidates[0] || current;
  }
  if (Array.isArray(next.priorities)) {
    next = { ...next, priorities: next.priorities.slice(0, 2) };
  }
  return next;
}

function enforceWorkoutCap(current, { focus, timeMin, checkIn, intensityCap, avoidGroups }) {
  if (current.intensityCost <= intensityCap && current.minutes <= timeMin) return current;
  return pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups });
}

export { focusFromProfile };
