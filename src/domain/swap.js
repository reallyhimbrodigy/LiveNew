function sortById(list) {
  return list.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function pickByTag(list, tag) {
  const filtered = list.filter((item) => item.tags?.includes(tag));
  const pool = filtered.length ? filtered : list;
  return sortById(pool)[0] || null;
}

function pickShortest(list) {
  if (!list.length) return null;
  return list.slice().sort((a, b) => (a.durationSec || 0) - (b.durationSec || 0) || a.id.localeCompare(b.id))[0];
}

function pickEasiestMovement(list) {
  if (!list.length) return null;
  return list
    .slice()
    .sort(
      (a, b) =>
        (a.intensity || 0) - (b.intensity || 0) ||
        (a.durationMin || 0) - (b.durationMin || 0) ||
        a.id.localeCompare(b.id)
    )[0];
}

function isResetDemandIncrease(current, next) {
  if (!current || !next) return false;
  const currentSec = Number(current.durationSec || 0);
  const nextSec = Number(next.durationSec || 0);
  return nextSec > currentSec;
}

function isMovementDemandIncrease(current, next) {
  if (!current || !next) return false;
  const currentIntensity = Number(current.intensity || 0);
  const nextIntensity = Number(next.intensity || 0);
  if (nextIntensity > currentIntensity) return true;
  const currentMin = Number(current.durationMin || 0);
  const nextMin = Number(next.durationMin || 0);
  return nextMin > currentMin;
}

export function applyQuickSignal({ signal, todaySelection, scored, profile, constraints, libraries }) {
  const resets = libraries?.resets || [];
  const movement = libraries?.movement || [];
  const nutrition = libraries?.nutrition || [];

  const current = {
    resetId: todaySelection?.resetId || null,
    movementId: todaySelection?.movementId || null,
    nutritionId: todaySelection?.nutritionId || null,
  };

  const resetById = new Map(resets.map((item) => [item.id, item]));
  const moveById = new Map(movement.map((item) => [item.id, item]));
  const nutritionById = new Map(nutrition.map((item) => [item.id, item]));

  let nextReset = resetById.get(current.resetId) || null;
  let nextMovement = moveById.get(current.movementId) || null;
  let nextNutrition = nutritionById.get(current.nutritionId) || null;

  if (signal === "stressed") {
    const preferred = pickByTag(resets, "downshift");
    if (nextReset?.tags?.includes("downshift") !== true) {
      if (!isResetDemandIncrease(nextReset, preferred)) nextReset = preferred;
    }
    if ((scored?.capacity || 0) < 70) nextMovement = null;
  }

  if (signal === "exhausted") {
    const preferred = pickByTag(resets, "downshift");
    const resetChanged = nextReset?.tags?.includes("downshift") !== true && !isResetDemandIncrease(nextReset, preferred);
    if (resetChanged) nextReset = preferred;
    nextMovement = null;
    const exhaustedSatisfied = nextReset?.tags?.includes("downshift") === true && nextMovement == null;
    if (!resetChanged && !exhaustedSatisfied && !nextNutrition?.tags?.includes("simple")) {
      nextNutrition = pickByTag(nutrition, "simple");
    }
  }

  if (signal === "ten_minutes") {
    const shortest = pickShortest(resets);
    const resetChanged = nextReset?.id !== shortest?.id && !isResetDemandIncrease(nextReset, shortest);
    if (resetChanged) nextReset = shortest;
    nextMovement = null;
    const tenSatisfied = nextReset?.id === shortest?.id && nextMovement == null;
    if (!resetChanged && !tenSatisfied && !nextNutrition?.tags?.includes("simple")) {
      nextNutrition = pickByTag(nutrition, "simple");
    }
  }

  if (signal === "more_energy") {
    if (!nextMovement && (scored?.capacity || 0) >= 70) {
      const candidate = pickByTag(movement, "light") || pickEasiestMovement(movement);
      if (!isMovementDemandIncrease(nextMovement, candidate)) nextMovement = candidate;
    }
  }

  return {
    resetId: nextReset?.id || null,
    movementId: nextMovement?.id || null,
    nutritionId: nextNutrition?.id || null,
  };
}
