export const RULES_ORDER = [
  "profile_override",
  "busy_day",
  "keep_focus",
  "time_min_constraint",
  "poor_sleep_constraint",
  "wired_constraint",
  "depleted_constraint",
  "recovery_debt_bias",
  "signal_override",
  "feedback_modifier",
  "reset_focus_override",
  "bad_day_mode",
  "novelty_avoidance",
  "safety_block",
  "emergency_downshift",
  "quality_gate",
  "quality_gate_fallback",
  "experiment_pack_override",
  "experiment_params_override",
  "rail_reset",
];

export function normalizeAppliedRules(appliedRules) {
  const items = Array.isArray(appliedRules) ? appliedRules : [];
  const seen = new Set();
  const entries = [];
  items.forEach((rule, idx) => {
    if (!rule || seen.has(rule)) return;
    seen.add(rule);
    const orderIndex = RULES_ORDER.indexOf(rule);
    entries.push({ rule, orderIndex: orderIndex === -1 ? 9999 : orderIndex, idx });
  });
  entries.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return a.idx - b.idx;
  });
  return entries.map((entry) => entry.rule);
}

const RULE_SET = new Set(RULES_ORDER);
const ALPHA_LIKE = new Set(["alpha", "prod"]);

function resolveEnvMode(config) {
  const mode = config?.envMode || process.env.ENV_MODE || "dev";
  return String(mode).trim().toLowerCase() || "dev";
}

function isAlphaLike(config) {
  return ALPHA_LIKE.has(resolveEnvMode(config));
}

function isRulesFrozen(config) {
  if (typeof config?.rulesFrozen === "boolean") return config.rulesFrozen;
  const envFlag = String(process.env.RULES_FROZEN || "").toLowerCase();
  if (envFlag === "true") return true;
  if (envFlag === "false") return false;
  return isAlphaLike(config);
}

function logUnknownRule(config, rule, event = "unknown_rule_dropped") {
  const logger = config?.logger;
  const payload = { event, rule };
  if (logger?.warn) {
    logger.warn(payload);
    return;
  }
  if (logger?.info) {
    logger.info(payload);
    return;
  }
  // Fall back to a single line for safety without introducing new deps.
  console.warn(event, rule);
}

function unknownRuleError(unknownRules) {
  const err = new Error(`Unknown rule(s): ${unknownRules.join(", ")}`);
  err.code = "unknown_rule";
  err.httpStatus = 500;
  err.details = { unknownRules };
  return err;
}

export function appendAppliedRule(appliedRules, rule, config = {}) {
  if (!rule) return appliedRules;
  const list = Array.isArray(appliedRules) ? appliedRules : [];
  if (RULE_SET.has(rule)) {
    list.push(rule);
    return list;
  }
  if (isRulesFrozen(config)) {
    if (isAlphaLike(config)) {
      logUnknownRule(config, rule, "unknown_rule_dropped");
      return list;
    }
    throw unknownRuleError([rule]);
  }
  list.push(rule);
  return list;
}

export function validateAppliedRules(appliedRules, config = {}) {
  const items = Array.isArray(appliedRules) ? appliedRules : [];
  const unknown = items.filter((rule) => !RULE_SET.has(rule));
  if (!unknown.length) return normalizeAppliedRules(items);
  if (isAlphaLike(config)) {
    unknown.forEach((rule) => logUnknownRule(config, rule, "unknown_rule_dropped"));
    const filtered = items.filter((rule) => RULE_SET.has(rule));
    return normalizeAppliedRules(filtered);
  }
  throw unknownRuleError(unknown);
}
