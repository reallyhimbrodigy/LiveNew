export const RULES_ORDER = [
  "busy_day",
  "time_min_constraint",
  "poor_sleep_constraint",
  "wired_constraint",
  "depleted_constraint",
  "signal_override",
  "bad_day_mode",
  "feedback_modifier",
  "novelty_avoidance",
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
