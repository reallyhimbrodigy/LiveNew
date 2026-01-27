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
    safetyEnabled: true,
    ...(next.ruleToggles || {}),
  };

  if (next.userProfile) {
    next.userProfile = {
      ...next.userProfile,
      contentPack: next.userProfile.contentPack || "balanced_routine",
      timezone: next.userProfile.timezone || "America/Los_Angeles",
      dataMinimization: (() => {
        const dataMin = next.userProfile.dataMinimization || {};
        const enabled = Boolean(dataMin.enabled);
        const eventDays = Number.isFinite(Number(dataMin.eventRetentionDays)) ? Number(dataMin.eventRetentionDays) : 90;
        const historyDays = Number.isFinite(Number(dataMin.historyRetentionDays)) ? Number(dataMin.historyRetentionDays) : 90;
        const cap = enabled ? 30 : 365;
        return {
          enabled,
          storeNotes: dataMin.storeNotes !== false,
          storeTraces: dataMin.storeTraces !== false,
          eventRetentionDays: Math.min(eventDays, cap),
          historyRetentionDays: Math.min(historyDays, cap),
        };
      })(),
    };
  }

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
