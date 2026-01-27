import { defaultLibrary } from "../content/library.js";
import { constraintsContextForUser, filterByConstraints, itemAllowedByConstraints } from "./constraintsMemory.js";

function pushRationale(rationale, line) {
  if (!rationale.includes(line)) rationale.push(line);
}

function eligiblePool(items, constraintsContext) {
  const strict = filterByConstraints(items, constraintsContext);
  if (strict.length) return strict;
  const relaxed = filterByConstraints(items, constraintsContext, { relaxEquipment: true });
  if (relaxed.length) return relaxed;
  if (constraintsContext?.injuriesSet?.size) return [];
  return items;
}

function safeFallback(fallback, constraintsContext) {
  if (!fallback) return fallback;
  if (!constraintsContext) return fallback;
  if (itemAllowedByConstraints(fallback, constraintsContext, { relaxEquipment: true })) {
    return fallback;
  }
  return constraintsContext?.injuriesSet?.size ? null : fallback;
}

function pickWorkout(predicate, fallback, timeLimit, library, constraintsContext) {
  const lib = library?.workouts || defaultLibrary.workouts;
  const pool = eligiblePool(lib, constraintsContext);
  const candidates = pool
    .filter((w) => predicate(w))
    .filter((w) => (timeLimit != null ? w.minutes <= timeLimit : true))
    .sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes);
  const fallbackSafe = safeFallback(fallback, constraintsContext);
  return candidates[0] || fallbackSafe;
}

function pickReset(predicate, fallback, timeLimit, library, constraintsContext) {
  const lib = library?.resets || defaultLibrary.resets;
  const pool = eligiblePool(lib, constraintsContext);
  const candidates = pool
    .filter((r) => predicate(r))
    .filter((r) => (timeLimit != null ? r.minutes <= timeLimit : true))
    .sort((a, b) => a.intensityCost - b.intensityCost || a.minutes - b.minutes);
  const fallbackSafe = safeFallback(fallback, constraintsContext);
  return candidates[0] || fallbackSafe;
}

export function applyConstraints({ user, checkIn, state, dayDraft, library, constraintsContext }) {
  const next = { ...dayDraft };
  const rationale = dayDraft.rationale ? dayDraft.rationale.slice() : [];
  const constraintsCtx = constraintsContext || constraintsContextForUser(user);

  const timeMin = checkIn ? checkIn.timeAvailableMin : undefined;

  // C1: PoorSleep
  if (state.profile === "PoorSleep") {
    next.focus = "downshift";
    next.workout = pickWorkout(
      (w) => ["walk", "mobility", "yoga"].includes(w.modality) && w.intensityCost <= 3,
      next.workout,
      timeMin,
      library,
      constraintsCtx
    );
    next.reset = pickReset(
      (r) => r.tags.includes("sleep") || r.tags.includes("downshift"),
      next.reset,
      timeMin ? Math.min(5, Math.max(2, Math.floor(timeMin / 10))) : undefined,
      library,
      constraintsCtx
    );
    pushRationale(rationale, "Constraint: PoorSleep -> downshift + low intensity");
  }

  // C2: <= 10 minutes available
  if (checkIn && checkIn.timeAvailableMin <= 10) {
    next.workout = pickWorkout((w) => w.minutes <= 10, next.workout, 10, library, constraintsCtx);
    next.reset = pickReset((r) => r.minutes <= 3, next.reset, 3, library, constraintsCtx);
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
    next.workout = pickWorkout((w) => w.intensityCost <= 4, next.workout, timeMin, library, constraintsCtx);
    next.reset = pickReset((r) => r.tags.includes("downshift") && r.minutes <= 3, next.reset, 3, library, constraintsCtx);
    pushRationale(rationale, "Constraint: WiredOverstimulated -> cap intensity");
  }

  // C4: DepletedBurnedOut
  if (state.profile === "DepletedBurnedOut") {
    next.workout = pickWorkout(
      (w) => w.intensityCost <= 4 && (w.modality !== "strength" || w.minutes <= 15),
      next.workout,
      timeMin,
      library,
      constraintsCtx
    );
    pushRationale(rationale, "Constraint: DepletedBurnedOut -> protect recovery");
  }

  next.rationale = rationale;
  return next;
}
