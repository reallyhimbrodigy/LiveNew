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
    if (nextReset?.tags?.includes("downshift") !== true) nextReset = preferred;
    if ((scored?.capacity || 0) < 70) nextMovement = null;
  }

  if (signal === "exhausted") {
    const preferred = pickByTag(resets, "downshift");
    if (nextReset?.tags?.includes("downshift") !== true) nextReset = preferred;
    nextMovement = null;
    if (!nextNutrition?.tags?.includes("simple")) {
      nextNutrition = pickByTag(nutrition, "simple");
    }
  }

  if (signal === "ten_minutes") {
    const shortest = pickShortest(resets);
    if (nextReset?.id !== shortest?.id) nextReset = shortest;
    nextMovement = null;
    if (!nextNutrition?.tags?.includes("simple")) {
      nextNutrition = pickByTag(nutrition, "simple");
    }
  }

  if (signal === "more_energy") {
    if (!nextMovement && (scored?.capacity || 0) >= 70) {
      nextMovement = pickByTag(movement, "light") || pickEasiestMovement(movement);
    }
  }

  return {
    resetId: nextReset?.id || null,
    movementId: nextMovement?.id || null,
    nutritionId: nextNutrition?.id || null,
  };
}
