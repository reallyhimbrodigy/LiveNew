const INJURY_KEYS = ["knee", "shoulder", "back"];
const EQUIPMENT_KEYS = ["none", "dumbbells", "bands", "gym"];
const TIME_PREFS = new Set(["morning", "midday", "evening", "any"]);

function normalizeFlags(source, keys, defaults = {}) {
  const next = { ...defaults };
  keys.forEach((key) => {
    const value = source?.[key];
    if (value === true || value === false) {
      next[key] = value;
    } else if (next[key] == null) {
      next[key] = false;
    }
  });
  return next;
}

export function normalizeConstraintsMemory(constraints) {
  const injuries = normalizeFlags(constraints?.injuries, INJURY_KEYS);
  const equipment = normalizeFlags(constraints?.equipment, EQUIPMENT_KEYS, { none: true });
  const anyEquipment = EQUIPMENT_KEYS.some((key) => key !== "none" && equipment[key]);
  if (!equipment.none && !anyEquipment) {
    equipment.none = true;
  }
  const prefRaw = typeof constraints?.timeOfDayPreference === "string" ? constraints.timeOfDayPreference.trim().toLowerCase() : "any";
  const timeOfDayPreference = TIME_PREFS.has(prefRaw) ? prefRaw : "any";
  return {
    injuries,
    equipment,
    timeOfDayPreference,
  };
}

export function constraintsContextForUser(user) {
  const normalized = normalizeConstraintsMemory(user?.constraints || {});
  const injuriesSet = new Set(Object.entries(normalized.injuries).filter(([, value]) => value).map(([key]) => key));
  const equipmentSet = new Set(Object.entries(normalized.equipment).filter(([, value]) => value).map(([key]) => key));
  return {
    normalized,
    injuriesSet,
    equipmentSet,
    timeOfDayPreference: normalized.timeOfDayPreference,
  };
}

function hasContraindication(item, ctx) {
  if (!ctx?.injuriesSet?.size) return false;
  const contraindications = Array.isArray(item?.contraindications) ? item.contraindications : [];
  return contraindications.some((key) => ctx.injuriesSet.has(String(key)));
}

function hasRequiredEquipment(item, ctx, relaxEquipment) {
  if (relaxEquipment) return true;
  const required = Array.isArray(item?.equipment) ? item.equipment : [];
  if (!required.length) return true;
  if (!ctx?.equipmentSet?.size) return required.includes("none");
  return required.some((key) => ctx.equipmentSet.has(String(key)));
}

export function itemAllowedByConstraints(item, ctx, options = {}) {
  if (!item) return false;
  if (!ctx) return true;
  if (hasContraindication(item, ctx)) return false;
  return hasRequiredEquipment(item, ctx, options.relaxEquipment === true);
}

export function filterByConstraints(items, ctx, options = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  return items.filter((item) => itemAllowedByConstraints(item, ctx, options));
}

export function timeOfDayBoost(item, ctx) {
  const pref = ctx?.timeOfDayPreference;
  if (!pref || pref === "any") return 0;
  const ideal = Array.isArray(item?.idealTimeOfDay) ? item.idealTimeOfDay : [];
  return ideal.includes(pref) ? 0.25 : 0;
}
