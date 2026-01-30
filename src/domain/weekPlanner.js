import crypto from "crypto";
import { addDaysISO } from "./utils/date.js";
import { computeLoadCapacity } from "./scoring.js";
import { assignProfile } from "./profiles.js";
import { RESET_LIBRARY } from "./libraries/resets.js";
import { MOVEMENT_LIBRARY } from "./libraries/movement.js";
import { NUTRITION_LIBRARY } from "./libraries/nutrition.js";
import { LIB_VERSION } from "./libraryVersion.js";

function hashToInt(input) {
  const hex = crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 8);
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value : 0;
}

function pickBySeed(list, seed) {
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => a.id.localeCompare(b.id));
  const index = hashToInt(seed) % sorted.length;
  return sorted[index];
}

function buildContraSet(constraints) {
  const injuries = constraints?.injuries || {};
  const active = new Set();
  if (injuries.knee) active.add("injury:knee");
  if (injuries.shoulder) active.add("injury:shoulder");
  if (injuries.back) active.add("injury:back");
  if (injuries.neck) active.add("injury:neck");
  return active;
}

function buildAvoidSet(constraints) {
  const avoid = new Set();
  const diet = constraints?.diet || {};
  const list = Array.isArray(diet.avoidTags) ? diet.avoidTags : [];
  list.forEach((tag) => {
    if (typeof tag === "string" && tag.trim()) avoid.add(tag.trim());
  });
  return avoid;
}

function buildEquipmentSet(constraints) {
  const equipment = constraints?.equipment || {};
  const allowed = new Set();
  if (equipment.none !== false) allowed.add("eq:none");
  if (equipment.dumbbells) allowed.add("eq:dumbbells");
  if (equipment.bands) allowed.add("eq:bands");
  if (equipment.gym) allowed.add("eq:gym");
  return allowed;
}

function hasConflict(item, contraSet) {
  const contraTags = Array.isArray(item.contraTags) ? item.contraTags : [];
  return contraTags.some((tag) => contraSet.has(tag));
}

function equipmentAllowed(item, allowedEquipment) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const eqTags = tags.filter((tag) => tag.startsWith("eq:"));
  if (!eqTags.length) return true;
  if (!allowedEquipment.size) return true;
  return eqTags.some((tag) => allowedEquipment.has(tag));
}

function filterResets({ timeMin, constraints, libraries }) {
  const contraSet = buildContraSet(constraints);
  const maxSec = timeMin <= 5 ? 180 : 300;
  return (libraries?.resets || RESET_LIBRARY)
    .filter(
      (item) =>
        !hasConflict(item, contraSet) &&
        Number(item.durationSec) <= maxSec &&
        Number(item.durationSec) >= 120
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function filterMovement({ scores, timeMin, constraints, profile, libraries }) {
  const contraSet = buildContraSet(constraints);
  const avoidSet = buildAvoidSet(constraints);
  const allowedEquipment = buildEquipmentSet(constraints);
  let pool = (libraries?.movement || MOVEMENT_LIBRARY).filter(
    (item) =>
      !hasConflict(item, contraSet) &&
      !(item.tags || []).some((tag) => avoidSet.has(tag)) &&
      equipmentAllowed(item, allowedEquipment) &&
      Number(item.durationMin) <= timeMin
  );

  if (scores.capacity < 40 || profile === "Depleted/Burned Out" || profile === "Poor Sleep") {
    pool = pool.filter((item) => item.tags?.includes("downshift") || item.tags?.includes("light"));
  }

  return pool.sort((a, b) => a.id.localeCompare(b.id));
}

function filterNutrition({ constraints, libraries }) {
  const contraSet = buildContraSet(constraints);
  const avoidSet = buildAvoidSet(constraints);
  return (libraries?.nutrition || NUTRITION_LIBRARY)
    .filter((item) => !hasConflict(item, contraSet) && !(item.tags || []).some((tag) => avoidSet.has(tag)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildWeekSkeleton({
  userId,
  startDateKey,
  timezone,
  dayBoundaryHour,
  baseline,
  libVersion,
  libraries,
}) {
  if (!userId || !startDateKey) return [];
  const constraints = baseline?.constraints || {};
  const version = libVersion || LIB_VERSION;
  const defaults = {
    stress: 5,
    sleepQuality: 6,
    energy: 6,
    timeAvailableMin: 20,
  };
  const results = [];
  for (let i = 0; i < 7; i += 1) {
    const dateKey = addDaysISO(startDateKey, i);
    const scores = computeLoadCapacity({
      stress: defaults.stress,
      sleepQuality: defaults.sleepQuality,
      energy: defaults.energy,
      timeMin: defaults.timeAvailableMin,
    });
    const profile = assignProfile({
      load: scores.load,
      capacity: scores.capacity,
      sleep: defaults.sleepQuality,
      energy: defaults.energy,
    });
    const resetPool = filterResets({ timeMin: defaults.timeAvailableMin, constraints, libraries });
    const movementPool = filterMovement({
      scores,
      timeMin: defaults.timeAvailableMin,
      constraints,
      profile,
      libraries,
    });
    const nutritionPool = filterNutrition({ constraints, libraries });

    const seedBase = [userId, dateKey, profile, timezone || "", String(dayBoundaryHour ?? ""), version].join("|");

    const reset = pickBySeed(resetPool, `${seedBase}|reset`) || resetPool[0] || null;
    const movement = scores.capacity >= 55 ? pickBySeed(movementPool, `${seedBase}|movement`) : null;
    const nutrition = pickBySeed(nutritionPool, `${seedBase}|nutrition`) || nutritionPool[0] || null;

    results.push({
      dateKey,
      resetId: reset?.id || null,
      movementId: movement?.id || null,
      nutritionId: nutrition?.id || null,
    });
  }
  return results;
}
