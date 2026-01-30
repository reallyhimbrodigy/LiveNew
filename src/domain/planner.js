import crypto from "crypto";
import { computeLoadCapacity } from "./scoring.js";
import { assignProfile } from "./profiles.js";
import { LIB_VERSION } from "./libraryVersion.js";
import { RESET_LIBRARY } from "./libraries/resets.js";
import { MOVEMENT_LIBRARY } from "./libraries/movement.js";
import { NUTRITION_LIBRARY } from "./libraries/nutrition.js";

function hashToInt(input) {
  const hex = crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 8);
  const value = Number.parseInt(hex, 16);
  return Number.isFinite(value) ? value : 0;
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeCheckin(checkin, dateKey) {
  return {
    dateKey,
    stress: clampInt(checkin?.stress, 1, 10, 5),
    sleep: clampInt(checkin?.sleepQuality ?? checkin?.sleep, 1, 10, 6),
    energy: clampInt(checkin?.energy, 1, 10, 6),
    timeMin: clampInt(checkin?.timeMin ?? checkin?.timeAvailableMin, 5, 60, 10),
    safety: {
      panic: Boolean(checkin?.safety?.panic || checkin?.panic),
    },
  };
}

function normalizeConstraints(constraints) {
  if (!constraints || typeof constraints !== "object") return {};
  return constraints;
}

function normalizeConstraintsForHash(constraints) {
  if (!constraints || typeof constraints !== "object") return {};
  const copy = JSON.parse(JSON.stringify(constraints));
  const sortArrays = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.sort((a, b) => String(a).localeCompare(String(b)));
      obj.forEach((entry) => sortArrays(entry));
      return;
    }
    Object.keys(obj).forEach((key) => {
      sortArrays(obj[key]);
    });
  };
  sortArrays(copy);
  return copy;
}

function stableStringify(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
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

function pickBySeed(list, seed) {
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => a.id.localeCompare(b.id));
  const index = hashToInt(seed) % sorted.length;
  return sorted[index];
}

function keepIfEligible(list, id) {
  if (!id) return null;
  return list.find((item) => item.id === id) || null;
}

function filterResets({ checkin, constraints }) {
  const contraSet = buildContraSet(constraints);
  const maxSec = checkin.timeMin <= 5 ? 180 : 300;
  return RESET_LIBRARY.filter(
    (item) =>
      !hasConflict(item, contraSet) &&
      Number(item.durationSec) <= maxSec &&
      Number(item.durationSec) >= 120
  ).sort((a, b) => a.id.localeCompare(b.id));
}

function filterMovement({ scores, checkin, constraints, profile }) {
  const contraSet = buildContraSet(constraints);
  const avoidSet = buildAvoidSet(constraints);
  const allowedEquipment = buildEquipmentSet(constraints);
  const timeMin = checkin.timeMin;
  let pool = MOVEMENT_LIBRARY.filter(
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

function filterNutrition({ constraints }) {
  const contraSet = buildContraSet(constraints);
  const avoidSet = buildAvoidSet(constraints);
  return NUTRITION_LIBRARY.filter(
    (item) => !hasConflict(item, contraSet) && !(item.tags || []).some((tag) => avoidSet.has(tag))
  ).sort((a, b) => a.id.localeCompare(b.id));
}

function simpleNutrition(library) {
  const simple = library.filter((item) => item.tags?.includes("simple"));
  const list = simple.length ? simple : library;
  return list.slice().sort((a, b) => a.id.localeCompare(b.id))[0] || null;
}

function buildRationale({ profile, scores, checkin, panicMode }) {
  const bullets = [];
  bullets.push(`Profile: ${profile}`);
  bullets.push(`Load ${scores.load}/100, capacity ${scores.capacity}/100.`);
  if (checkin.timeMin <= 10) bullets.push("Short window today, keep it simple.");
  if (panicMode) bullets.push("Take the smallest safe step first.");
  return bullets;
}

export function buildToday(input) {
  const dateKey = input?.dateKey || input?.dateISO;
  const baseline = input?.baseline || {};
  const constraints = normalizeConstraints(baseline?.constraints);
  const checkin = normalizeCheckin(input?.latestCheckin || {}, dateKey);
  const scores = computeLoadCapacity({
    stress: checkin.stress,
    sleepQuality: checkin.sleep,
    energy: checkin.energy,
    timeMin: checkin.timeMin,
  });
  const profile = assignProfile({
    load: scores.load,
    capacity: scores.capacity,
    sleep: checkin.sleep,
    energy: checkin.energy,
    priorProfile: input?.priorProfile || null,
  });
  const panicMode = Boolean(input?.panicMode || checkin.safety?.panic);
  const dayState = input?.dayState || {};
  const lastQuickSignal = dayState.lastQuickSignal || "";
  const weekSeed = input?.weekSeed || {};

  const resetPool = filterResets({ checkin, constraints });
  const movementPool = panicMode ? [] : filterMovement({ scores, checkin, constraints, profile });
  const nutritionPool = filterNutrition({ constraints });

  const seedBase = [
    input?.userId || "",
    dateKey || "",
    profile,
    lastQuickSignal,
    input?.libVersion || LIB_VERSION,
    `${checkin.stress}-${checkin.sleep}-${checkin.energy}-${checkin.timeMin}`,
  ].join("|");

  let reset =
    keepIfEligible(resetPool, dayState.resetId) ||
    keepIfEligible(resetPool, weekSeed.resetId) ||
    pickBySeed(resetPool, `${seedBase}|reset`);
  if (!reset) reset = RESET_LIBRARY[0];

  let movement = null;
  if (!panicMode) {
    const kept = keepIfEligible(movementPool, dayState.movementId);
    if (kept) movement = kept;
    else if (weekSeed.movementId) movement = keepIfEligible(movementPool, weekSeed.movementId);
    else if (scores.capacity >= 55 && checkin.timeMin >= 10) {
      movement = pickBySeed(movementPool, `${seedBase}|movement`);
    }
  }

  let nutrition =
    keepIfEligible(nutritionPool, dayState.nutritionId) ||
    keepIfEligible(nutritionPool, weekSeed.nutritionId) ||
    pickBySeed(nutritionPool, `${seedBase}|nutrition`);
  if (!nutrition) nutrition = simpleNutrition(NUTRITION_LIBRARY) || { id: "nutrition_simple", title: "Simple fuel", bullets: [] };

  if (panicMode) {
    movement = null;
    nutrition = simpleNutrition(nutritionPool) || nutrition;
  }

  const events = Array.isArray(input?.eventsToday) ? input.eventsToday : [];
  const resetCompleted = events.some((event) => event?.type === "reset_completed");

  const selection = {
    resetId: reset?.id || null,
    movementId: movement?.id || null,
    nutritionId: nutrition?.id || null,
    lastQuickSignal,
  };
  const dayStateSnapshot = {
    resetId: input?.dayState?.resetId || null,
    movementId: input?.dayState?.movementId || null,
    nutritionId: input?.dayState?.nutritionId || null,
    lastQuickSignal: input?.dayState?.lastQuickSignal || "",
  };

  const normalizedConstraints = normalizeConstraintsForHash(constraints);
  const inputParts = [
    input?.userId || "",
    dateKey || "",
    input?.timezone || "",
    String(input?.dayBoundaryHour ?? ""),
    String(checkin.stress),
    String(checkin.sleep),
    String(checkin.energy),
    String(checkin.timeMin),
    String(checkin.safety?.panic ? 1 : 0),
    selection.resetId || "",
    selection.movementId || "",
    selection.nutritionId || "",
    selection.lastQuickSignal || "",
    dayStateSnapshot.resetId || "",
    dayStateSnapshot.movementId || "",
    dayStateSnapshot.nutritionId || "",
    dayStateSnapshot.lastQuickSignal || "",
    weekSeed.resetId || "",
    weekSeed.movementId || "",
    weekSeed.nutritionId || "",
    input?.priorProfile || "",
    stableStringify(normalizedConstraints),
    input?.libVersion || LIB_VERSION,
  ];
  const inputHash = crypto.createHash("sha256").update(inputParts.join("|")).digest("hex");

  return {
    ok: true,
    dateKey: dateKey,
    dateISO: dateKey,
    profile,
    scores,
    panicMode,
    reset: {
      id: reset.id,
      title: reset.title,
      durationSec: reset.durationSec,
      seconds: reset.durationSec,
      steps: Array.isArray(reset.steps) ? reset.steps : [],
    },
    movement: movement
      ? {
          id: movement.id,
          title: movement.title,
          durationMin: movement.durationMin,
          minutes: movement.durationMin,
          intensity: movement.intensity,
        }
      : null,
    nutrition: {
      id: nutrition.id,
      title: nutrition.title,
      bullets: Array.isArray(nutrition.bullets) ? nutrition.bullets : [],
    },
    rationale: buildRationale({ profile, scores, checkin, panicMode }),
    meta: {
      inputHash,
      completed: { reset: resetCompleted },
      continuity: input?.continuity || null,
    },
  };
}

export function buildTodayContract(input) {
  return buildToday(input);
}

export function getLibrarySnapshot() {
  return {
    resets: RESET_LIBRARY,
    movement: MOVEMENT_LIBRARY,
    nutrition: NUTRITION_LIBRARY,
  };
}
