import { defaultLibrary } from "../content/library";

function pushRationale(rationale, line) {
  if (!rationale.includes(line)) rationale.push(line);
}

function pickWorkout(predicate, fallback, timeLimit) {
  const candidates = defaultLibrary.workouts
    .filter((w) => predicate(w))
    .filter((w) => (timeLimit != null ? w.minutes <= timeLimit : true))
    .sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes);
  return candidates[0] || fallback;
}

function pickReset(predicate, fallback, timeLimit) {
  const candidates = defaultLibrary.resets
    .filter((r) => predicate(r))
    .filter((r) => (timeLimit != null ? r.minutes <= timeLimit : true))
    .sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes);
  return candidates[0] || fallback;
}

export function applyConstraints({ user, checkIn, state, dayDraft }) {
  void user;
  const next = { ...dayDraft };
  const rationale = dayDraft.rationale ? dayDraft.rationale.slice() : [];

  const timeMin = checkIn ? checkIn.timeAvailableMin : undefined;

  // C1: PoorSleep
  if (state.profile === "PoorSleep") {
    next.focus = "downshift";
    next.workout = pickWorkout(
      (w) => ["walk", "mobility", "yoga"].includes(w.modality) && w.intensityCost <= 3,
      next.workout,
      timeMin
    );
    next.reset = pickReset(
      (r) => r.tags.includes("sleep") || r.tags.includes("downshift"),
      next.reset,
      timeMin ? Math.min(5, Math.max(2, Math.floor(timeMin / 10))) : undefined
    );
    pushRationale(rationale, "Constraint: PoorSleep -> downshift + low intensity");
  }

  // C2: <= 10 minutes available
  if (checkIn && checkIn.timeAvailableMin <= 10) {
    next.workout = pickWorkout((w) => w.minutes <= 10, next.workout, 10);
    next.reset = pickReset((r) => r.minutes <= 3, next.reset, 3);
    if (next.nutrition && Array.isArray(next.nutrition.priorities)) {
      next.nutrition = {
        ...next.nutrition,
        priorities: next.nutrition.priorities.slice(0, 2),
      };
    }
    pushRationale(rationale, "Constraint: <=10 minutes -> minimum-effective dose");
  }

  // C3: WiredOverstimulated
  if (state.profile === "WiredOverstimulated") {
    next.workout = pickWorkout((w) => w.intensityCost <= 4, next.workout, timeMin);
    next.reset = pickReset((r) => r.tags.includes("downshift") && r.minutes <= 3, next.reset, 3);
    pushRationale(rationale, "Constraint: WiredOverstimulated -> cap intensity");
  }

  // C4: DepletedBurnedOut
  if (state.profile === "DepletedBurnedOut") {
    next.workout = pickWorkout(
      (w) => w.intensityCost <= 4 && (w.modality !== "strength" || w.minutes <= 15),
      next.workout,
      timeMin
    );
    pushRationale(rationale, "Constraint: DepletedBurnedOut -> protect recovery");
  }

  next.rationale = rationale;
  return next;
}
