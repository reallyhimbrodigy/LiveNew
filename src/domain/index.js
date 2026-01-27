export { defaultLibrary } from "./content/library.js";
export { getLibraryIndex, setLibraryIndex } from "./content/indexer.js";
export { weekStartMonday, addDaysISO, isoToday } from "./utils/date.js";
export { nowDateISO, toDateISOInTz, validateDateISO } from "./utils/dateISO.js";
export { nowInTz, toDateISOWithBoundary, parseDateISO, validateTimeZone } from "./utils/time.js";

export { computeStressLoad } from "./scoring/stressLoad.js";
export { computeCapacity } from "./scoring/capacity.js";
export { assignStressProfile } from "./scoring/profile.js";
export { computeRecoveryDebt } from "./scoring/recoveryDebt.js";

export { APP_LOG_SCHEMA_VERSION } from "./constants.js";
export { DECISION_PIPELINE_VERSION, STATE_SCHEMA_VERSION, normalizeState, validateState } from "./schema.js";

export { buildDayPlan } from "./planning/decision.js";
export { generateWeekPlan } from "./planning/generator.js";
export { adaptPlan } from "./planning/adapt.js";
export { swapWorkoutForDownshift, shortenDayTo10Min, upgradeDayIfReady } from "./planning/swap.js";
export { RULES_ORDER, normalizeAppliedRules } from "./planning/rules.js";

export { computeProgress } from "./kpis.js";
