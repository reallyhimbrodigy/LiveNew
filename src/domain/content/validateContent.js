function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n);
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateBaseItem(item, options = {}) {
  if (!item || typeof item !== "object") {
    return { ok: false, field: "item", message: "Item must be an object" };
  }
  if (!nonEmptyString(item.id)) {
    return { ok: false, field: "id", message: "id is required" };
  }
  if (!nonEmptyString(item.title)) {
    return { ok: false, field: "title", message: "title is required" };
  }
  if (!stringArray(item.tags)) {
    return { ok: false, field: "tags", message: "tags must be a string array" };
  }
  if (!options.allowDisabled && item.enabled === false) {
    return { ok: false, field: "enabled", message: "item must be enabled" };
  }
  return { ok: true };
}

export function validateWorkoutItem(item, options = {}) {
  const base = validateBaseItem(item, options);
  if (!base.ok) return base;
  if (!finiteNumber(item.minutes)) {
    return { ok: false, field: "minutes", message: "minutes is required" };
  }
  if (!finiteNumber(item.intensityCost)) {
    return { ok: false, field: "intensityCost", message: "intensityCost is required" };
  }
  if (!stringArray(item.steps)) {
    return { ok: false, field: "steps", message: "steps must be a string array" };
  }
  return { ok: true };
}

export function validateResetItem(item, options = {}) {
  const base = validateBaseItem(item, options);
  if (!base.ok) return base;
  if (!finiteNumber(item.minutes)) {
    return { ok: false, field: "minutes", message: "minutes is required" };
  }
  if (!stringArray(item.steps)) {
    return { ok: false, field: "steps", message: "steps must be a string array" };
  }
  return { ok: true };
}

export function validateNutritionItem(item, options = {}) {
  const base = validateBaseItem(item, options);
  if (!base.ok) return base;
  if (!stringArray(item.priorities)) {
    return { ok: false, field: "priorities", message: "priorities must be a string array" };
  }
  return { ok: true };
}
