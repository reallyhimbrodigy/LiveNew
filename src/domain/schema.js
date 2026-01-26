export const DECISION_PIPELINE_VERSION = 1;
export const STATE_SCHEMA_VERSION = 1;

export function normalizeState(state = {}) {
  const next = { ...state };

  next.schemaVersion = STATE_SCHEMA_VERSION;
  next.userProfile = next.userProfile ?? null;
  next.weekPlan = next.weekPlan ?? null;
  next.checkIns = Array.isArray(next.checkIns) ? next.checkIns : [];
  next.lastStressStateByDate = next.lastStressStateByDate ?? {};
  next.modifiers = next.modifiers ?? {};
  next.feedback = Array.isArray(next.feedback) ? next.feedback : [];
  next.partCompletionByDate = next.partCompletionByDate ?? {};
  next.history = Array.isArray(next.history) ? next.history : [];
  next.eventLog = Array.isArray(next.eventLog) ? next.eventLog : [];
  next.selectionStats = next.selectionStats ?? { workouts: {}, nutrition: {}, resets: {} };
  next.ruleToggles = {
    constraintsEnabled: true,
    noveltyEnabled: true,
    feedbackEnabled: true,
    badDayEnabled: true,
    recoveryDebtEnabled: true,
    circadianAnchorsEnabled: true,
    ...(next.ruleToggles || {}),
  };

  return next;
}

export function validateState(state) {
  if (!state || state.schemaVersion == null) {
    throw new Error("State schemaVersion missing");
  }
  if (!Array.isArray(state.checkIns)) {
    throw new Error("State checkIns must be an array");
  }
  if (state.weekPlan) {
    if (!state.weekPlan.startDateISO || !Array.isArray(state.weekPlan.days)) {
      throw new Error("State weekPlan missing startDateISO or days");
    }
  }
  if (state.userProfile) {
    const profile = state.userProfile;
    if (!profile.wakeTime || !profile.bedTime || profile.sleepRegularity == null) {
      throw new Error("State userProfile missing wakeTime, bedTime, or sleepRegularity");
    }
  }
}
