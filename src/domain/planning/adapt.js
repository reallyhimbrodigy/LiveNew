import { addDaysISO } from "../utils/date";
import { assignStressProfile } from "../scoring/profile";
import { applyConstraints } from "./constraints";
import { focusFromProfile, pickWorkout, pickNutrition, pickReset, pickWorkoutWindow } from "./generator";

export function adaptPlan({ weekPlan, user, todayISO, checkIn, signal, checkInsByDate }) {
  const notes = [];
  let nextPlan = weekPlan;
  let changedDayISO;

  if (signal) {
    const override = buildOverrideFromSignal({ signal, checkIn, user, todayISO, checkInsByDate });
    const res = applyRebuild(nextPlan, user, todayISO, checkInsByDate, override);
    if (res.changed) {
      nextPlan = res.weekPlan;
      changedDayISO = todayISO;
      notes.push(`Signal applied for ${todayISO}`);
    }
  }

  if (checkIn && checkIn.stress >= 7 && checkIn.sleepQuality <= 5) {
    const tomorrowISO = addDaysISO(todayISO, 1);
    const res = applyRebuild(nextPlan, user, tomorrowISO, checkInsByDate, { focusBias: "downshift" });
    if (res.changed) {
      nextPlan = res.weekPlan;
      changedDayISO = tomorrowISO;
      notes.push("Tomorrow downshifted due to high stress + poor sleep");
    }
  }

  return { weekPlan: nextPlan, changedDayISO, notes };
}

function applyRebuild(weekPlan, user, dateISO, checkInsByDate, override) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, changed: false };

  const nextDays = weekPlan.days.slice();
  const rebuilt = rebuildDay({ user, dateISO, weekPlan, checkInsByDate, override });
  const prev = nextDays[idx];
  const changed = JSON.stringify(prev) !== JSON.stringify(rebuilt);
  nextDays[idx] = rebuilt;

  return { weekPlan: { ...weekPlan, days: nextDays }, changed };
}

function buildOverrideFromSignal({ signal, user, todayISO, checkInsByDate }) {
  const checkIn = checkInsByDate ? checkInsByDate[todayISO] : undefined;
  const state = assignStressProfile({ user, dateISO: todayISO, checkIn });

  if (signal === "im_stressed" || signal === "poor_sleep" || signal === "wired" || signal === "anxious") {
    return { focusBias: "downshift" };
  }

  if (signal === "im_exhausted") {
    return { focusBias: "stabilize", timeOverrideMin: 10 };
  }

  if (signal === "i_have_10_min") {
    return { timeOverrideMin: 10 };
  }

  if (signal === "i_have_more_energy") {
    if (state.capacity >= 60 && state.loadBand !== "high") return { focusBias: "rebuild" };
    return { focusBias: "stabilize" };
  }

  return null;
}

function rebuildDay({ user, dateISO, weekPlan, checkInsByDate, override }) {
  const checkIn = checkInsByDate ? checkInsByDate[dateISO] : undefined;
  const state = assignStressProfile({ user, dateISO, checkIn });
  let focus = focusFromProfile(state.profile, state.capacity);

  if (override && override.focusBias) {
    if (override.focusBias === "rebuild") {
      if (state.capacity >= 60 && state.loadBand !== "high") focus = "rebuild";
    } else {
      focus = override.focusBias;
    }
  }

  const baseTimeMin = override && override.timeOverrideMin != null
    ? override.timeOverrideMin
    : checkIn
      ? checkIn.timeAvailableMin
      : 20;

  const isBusy = Array.isArray(user.busyDays) && user.busyDays.includes(dateISO);
  const timeMin = isBusy ? Math.min(baseTimeMin, 15) : baseTimeMin;

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

  return applyConstraints({ user, checkIn, state, dayDraft });
}
