import { validateWorkoutItem, validateResetItem, validateNutritionItem } from "./validateContent.js";

function validatorForKind(kind) {
  if (kind === "workout") return validateWorkoutItem;
  if (kind === "reset") return validateResetItem;
  if (kind === "nutrition") return validateNutritionItem;
  return null;
}

function isStepArray(item) {
  if (!item) return [];
  if (Array.isArray(item.steps)) return item.steps;
  if (Array.isArray(item.priorities)) return item.priorities;
  return [];
}

function toStatus(item) {
  const status = typeof item?.status === "string" ? item.status.trim().toLowerCase() : "";
  if (status) return status;
  return item?.enabled === false ? "disabled" : "enabled";
}

function pushIssue(list, item, code, message) {
  list.push({
    id: item?.id || null,
    kind: item?.kind || null,
    status: toStatus(item),
    code,
    message,
  });
}

export function runContentChecks(items, { kind = "all", scope = "all" } = {}) {
  const list = Array.isArray(items) ? items : [];
  const errors = [];
  const warnings = [];

  const byStatus = {};
  const byKind = {};

  const idCounts = new Map();
  const titleCounts = new Map();

  list.forEach((item) => {
    if (!item) return;
    const status = toStatus(item);
    const kindKey = item.kind || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
    byKind[kindKey] = (byKind[kindKey] || 0) + 1;
    if (item.id) idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
    const titleKey = String(item.title || "").trim().toLowerCase();
    if (titleKey) titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1);
  });

  list.forEach((item) => {
    if (!item) return;
    const validate = validatorForKind(item.kind);
    if (!validate) {
      pushIssue(errors, item, "invalid_kind", "kind must be workout, reset, or nutrition");
      return;
    }
    const baseValidation = validate(item, { allowDisabled: true });
    if (!baseValidation.ok) {
      pushIssue(errors, item, "invalid_structure", baseValidation.message);
      return;
    }

    if (!Array.isArray(item.tags) || item.tags.length === 0) {
      pushIssue(errors, item, "missing_tags", "tags are required");
    }

    const steps = isStepArray(item);
    if (steps.length > 12) {
      pushIssue(errors, item, "too_many_steps", "steps/priorities should be 12 or fewer");
    }
    steps.forEach((step) => {
      if (typeof step === "string" && step.length > 140) {
        pushIssue(errors, item, "step_too_long", "each step should be 140 characters or fewer");
      }
    });

    if (item.kind === "workout") {
      const intensityCost = Number(item.intensityCost);
      const minutes = Number(item.minutes);
      if (!Number.isFinite(intensityCost) || intensityCost < 1 || intensityCost > 10) {
        pushIssue(errors, item, "intensity_invalid", "intensityCost must be between 1 and 10");
      }
      if (Number.isFinite(minutes) && minutes <= 10 && intensityCost > 7) {
        pushIssue(errors, item, "intensity_too_high_for_short", "short workouts must not exceed intensityCost 7");
      }
    }
  });

  idCounts.forEach((count, id) => {
    if (count > 1) {
      list.filter((item) => item?.id === id).forEach((item) => {
        pushIssue(errors, item, "duplicate_id", "duplicate id detected");
      });
    }
  });

  titleCounts.forEach((count, titleKey) => {
    if (count > 1) {
      const dupes = list.filter(
        (item) => String(item?.title || "").trim().toLowerCase() === titleKey
      );
      dupes.forEach((item) => {
        pushIssue(warnings, item, "duplicate_title", "duplicate title detected");
      });
    }
  });

  return {
    ok: errors.length === 0,
    kind,
    scope,
    errors,
    warnings,
    counts: { byStatus, byKind, total: list.length },
  };
}

