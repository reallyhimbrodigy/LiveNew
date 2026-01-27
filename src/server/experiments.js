import crypto from "crypto";

import {
  getExperimentAssignment,
  listRunningExperiments,
  upsertExperimentAssignment,
} from "../state/db.js";
import { badRequest } from "./errors.js";
import { validateParamValue } from "./parameters.js";

const SAFETY_DENYLIST = new Set(["profileThresholds", "recoveryDebtWeights"]);

function hashBucket(userId, experimentId) {
  const hash = crypto.createHash("sha256").update(`${userId}:${experimentId}`).digest("hex");
  const head = hash.slice(0, 8);
  const value = Number.parseInt(head, 16);
  if (!Number.isFinite(value)) return 0;
  return value % 100;
}

function chooseVariantIndex(bucket, variants) {
  if (!variants.length) return -1;
  return bucket % variants.length;
}

function normalizePercent(percent) {
  const num = Number(percent);
  if (!Number.isFinite(num)) return 100;
  return Math.max(0, Math.min(100, Math.floor(num)));
}

export async function assignVariant(experimentId, userId, variants, percent, options = {}) {
  const persist = options.persist !== false;
  if (!experimentId || !userId) return null;
  const normalizedVariants = Array.isArray(variants) ? variants.filter((v) => v && v.key) : [];
  if (!normalizedVariants.length) return null;

  const existing = await getExperimentAssignment(experimentId, userId);
  if (existing) {
    const matched = normalizedVariants.find((variant) => variant.key === existing.variantKey);
    return matched || null;
  }

  const bucket = hashBucket(userId, experimentId);
  const pct = normalizePercent(percent);
  if (bucket >= pct) return null;

  const idx = chooseVariantIndex(bucket, normalizedVariants);
  if (idx < 0) return null;
  const chosen = normalizedVariants[idx];
  if (persist) {
    await upsertExperimentAssignment(experimentId, userId, chosen.key);
  }
  return chosen;
}

function assertGuardrails(paramsOverride) {
  const keys = Object.keys(paramsOverride || {});
  const blocked = keys.filter((key) => SAFETY_DENYLIST.has(key));
  if (blocked.length) {
    throw badRequest(
      "experiment_guardrail_violation",
      `paramsOverride may not change safety thresholds: ${blocked.join(", ")}`,
      "paramsOverride"
    );
  }
}

function validateOverride(paramsOverride) {
  const keys = Object.keys(paramsOverride || {});
  for (const key of keys) {
    const value = paramsOverride[key];
    if (!validateParamValue(key, value)) {
      throw badRequest("invalid_experiment_override", `Invalid paramsOverride for ${key}`, "paramsOverride");
    }
  }
}

function matchesTargeting(targeting, cohortId) {
  if (!targeting || typeof targeting !== "object") return true;
  const cohorts = Array.isArray(targeting.cohorts) ? targeting.cohorts.filter(Boolean) : [];
  if (cohorts.length && !cohorts.includes(cohortId)) return false;
  return true;
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type;
  if (type !== "pack" && type !== "parameters") return null;
  const variants = Array.isArray(raw.variants) ? raw.variants.filter((v) => v && v.key) : [];
  if (variants.length < 2) return null;
  return {
    type,
    variants,
    targeting: raw.targeting || {},
  };
}

export async function applyExperiments({ userId, cohortId, params, logger, persistAssignments = true }) {
  if (!userId || !params) {
    return { paramsEffective: params, packOverride: null, experimentMeta: null, assignments: [] };
  }

  const experiments = (await listRunningExperiments()).slice().sort((a, b) => a.id.localeCompare(b.id));
  if (!experiments.length) {
    return { paramsEffective: params, packOverride: null, experimentMeta: null, assignments: [] };
  }

  let paramsEffective = { ...params };
  let packOverride = null;
  const assignments = [];
  const appliedParamsOverride = {};

  for (const exp of experiments) {
    const config = normalizeConfig(exp.config || exp.config_json || exp.configJson);
    if (!config) continue;
    if (!matchesTargeting(config.targeting, cohortId)) continue;
    const percent = normalizePercent(config.targeting.percent);
    const variant = await assignVariant(exp.id, userId, config.variants, percent, {
      persist: persistAssignments,
    });
    if (!variant) continue;

    assignments.push({ experimentId: exp.id, variantKey: variant.key });

    if (config.type === "pack" && variant.packId) {
      packOverride = variant.packId;
    }

    if (config.type === "parameters" && variant.paramsOverride && typeof variant.paramsOverride === "object") {
      try {
        assertGuardrails(variant.paramsOverride);
        validateOverride(variant.paramsOverride);
      } catch (err) {
        if (logger && typeof logger.warn === "function") {
          logger.warn({ event: "experiment_override_rejected", experimentId: exp.id, error: err?.code || err?.message });
        }
        throw err;
      }
      Object.assign(appliedParamsOverride, variant.paramsOverride);
      paramsEffective = { ...paramsEffective, ...variant.paramsOverride };
    }
  }

  const experimentMeta = assignments.length
    ? {
        assignments,
        packId: packOverride,
        paramsOverride: Object.keys(appliedParamsOverride).length ? appliedParamsOverride : null,
      }
    : null;

  return { paramsEffective, packOverride, experimentMeta, assignments };
}

export { SAFETY_DENYLIST };
