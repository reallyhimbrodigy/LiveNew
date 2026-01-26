const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNALS = new Set([
  "im_stressed",
  "im_exhausted",
  "i_have_10_min",
  "i_have_more_energy",
  "poor_sleep",
  "anxious",
  "wired",
]);
const FEEDBACK_REASONS = new Set(["too_hard", "too_easy", "wrong_time", "not_relevant"]);
const PARTS = new Set(["workout", "reset", "nutrition"]);
const TIME_OPTIONS = new Set([5, 10, 15, 20, 30, 45, 60]);
const REPLAY_EVENT_TYPES = new Set([
  "BASELINE_SAVED",
  "ENSURE_WEEK",
  "WEEK_REBUILD",
  "DAY_VIEWED",
  "CHECKIN_SAVED",
  "QUICK_SIGNAL",
  "STRESSOR_ADDED",
  "BAD_DAY_MODE",
  "FEEDBACK_SUBMITTED",
  "TOGGLE_PART_COMPLETION",
  "UNDO_LAST_CHANGE",
  "CLEAR_EVENT_LOG",
  "SET_RULE_TOGGLES",
  "APPLY_SCENARIO",
]);

function ok(value) {
  return { ok: true, value };
}

function fail(code, message, field) {
  return { ok: false, error: { code, message, field } };
}

function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isIntegerInRange(value, min, max) {
  const num = toNumber(value);
  if (num == null || !Number.isInteger(num)) return false;
  return num >= min && num <= max;
}

function isDateISO(value) {
  return typeof value === "string" && DATE_RE.test(value);
}

function isTime(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

export function validateProfile(body) {
  const userProfile = body?.userProfile;
  if (!userProfile || typeof userProfile !== "object") {
    return fail("profile_missing", "userProfile is required", "userProfile");
  }

  if (userProfile.wakeTime != null && !isTime(userProfile.wakeTime)) {
    return fail("profile_invalid", "wakeTime must be HH:MM", "wakeTime");
  }
  if (userProfile.bedTime != null && !isTime(userProfile.bedTime)) {
    return fail("profile_invalid", "bedTime must be HH:MM", "bedTime");
  }
  if (userProfile.sleepRegularity != null && !isIntegerInRange(userProfile.sleepRegularity, 1, 10)) {
    return fail("profile_invalid", "sleepRegularity must be 1..10", "sleepRegularity");
  }
  if (userProfile.caffeineCupsPerDay != null && !isIntegerInRange(userProfile.caffeineCupsPerDay, 0, 5)) {
    return fail("profile_invalid", "caffeineCupsPerDay must be 0..5", "caffeineCupsPerDay");
  }
  if (userProfile.lateCaffeineDaysPerWeek != null && !isIntegerInRange(userProfile.lateCaffeineDaysPerWeek, 0, 7)) {
    return fail("profile_invalid", "lateCaffeineDaysPerWeek must be 0..7", "lateCaffeineDaysPerWeek");
  }
  if (userProfile.sunlightMinutesPerDay != null && !isIntegerInRange(userProfile.sunlightMinutesPerDay, 0, 120)) {
    return fail("profile_invalid", "sunlightMinutesPerDay must be 0..120", "sunlightMinutesPerDay");
  }
  if (userProfile.lateScreenMinutesPerNight != null && !isIntegerInRange(userProfile.lateScreenMinutesPerNight, 0, 240)) {
    return fail("profile_invalid", "lateScreenMinutesPerNight must be 0..240", "lateScreenMinutesPerNight");
  }
  if (userProfile.alcoholNightsPerWeek != null && !isIntegerInRange(userProfile.alcoholNightsPerWeek, 0, 7)) {
    return fail("profile_invalid", "alcoholNightsPerWeek must be 0..7", "alcoholNightsPerWeek");
  }
  if (userProfile.mealTimingConsistency != null && !isIntegerInRange(userProfile.mealTimingConsistency, 1, 10)) {
    return fail("profile_invalid", "mealTimingConsistency must be 1..10", "mealTimingConsistency");
  }

  return ok({ userProfile });
}

export function validateCheckIn(body) {
  const checkIn = body?.checkIn;
  if (!checkIn || typeof checkIn !== "object") {
    return fail("checkin_missing", "checkIn is required", "checkIn");
  }
  if (!isDateISO(checkIn.dateISO)) {
    return fail("checkin_invalid", "dateISO must be YYYY-MM-DD", "dateISO");
  }
  if (!isIntegerInRange(checkIn.stress, 1, 10)) {
    return fail("checkin_invalid", "stress must be 1..10", "stress");
  }
  if (!isIntegerInRange(checkIn.sleepQuality, 1, 10)) {
    return fail("checkin_invalid", "sleepQuality must be 1..10", "sleepQuality");
  }
  if (!isIntegerInRange(checkIn.energy, 1, 10)) {
    return fail("checkin_invalid", "energy must be 1..10", "energy");
  }
  const timeAvailableMin = toNumber(checkIn.timeAvailableMin);
  if (timeAvailableMin == null || !TIME_OPTIONS.has(timeAvailableMin)) {
    return fail("checkin_invalid", "timeAvailableMin must be 5,10,15,20,30,45,60", "timeAvailableMin");
  }

  return ok({
    checkIn: {
      ...checkIn,
      stress: Number(checkIn.stress),
      sleepQuality: Number(checkIn.sleepQuality),
      energy: Number(checkIn.energy),
      timeAvailableMin: timeAvailableMin,
    },
  });
}

export function validateSignal(body) {
  const dateISO = body?.dateISO;
  const signal = body?.signal;
  if (!isDateISO(dateISO)) {
    return fail("signal_invalid", "dateISO must be YYYY-MM-DD", "dateISO");
  }
  if (!SIGNALS.has(signal)) {
    return fail("signal_invalid", "signal is not allowed", "signal");
  }
  return ok({ dateISO, signal });
}

export function validateFeedback(body) {
  const dateISO = body?.dateISO;
  const helped = body?.helped;
  const reason = body?.reason;
  if (!isDateISO(dateISO)) {
    return fail("feedback_invalid", "dateISO must be YYYY-MM-DD", "dateISO");
  }
  if (typeof helped !== "boolean") {
    return fail("feedback_invalid", "helped must be boolean", "helped");
  }
  if (helped === false) {
    if (!FEEDBACK_REASONS.has(reason)) {
      return fail("feedback_invalid", "reason required when helped is false", "reason");
    }
  }
  return ok({ dateISO, helped, reason });
}

export function validateComplete(body) {
  const dateISO = body?.dateISO;
  const part = body?.part;
  if (!isDateISO(dateISO)) {
    return fail("complete_invalid", "dateISO must be YYYY-MM-DD", "dateISO");
  }
  if (!PARTS.has(part)) {
    return fail("complete_invalid", "part is not allowed", "part");
  }
  return ok({ dateISO, part });
}

export function validateRules(body) {
  const ruleToggles = body?.ruleToggles;
  if (!ruleToggles || typeof ruleToggles !== "object") {
    return fail("rules_invalid", "ruleToggles is required", "ruleToggles");
  }
  const fields = ["constraintsEnabled", "noveltyEnabled", "feedbackEnabled", "badDayEnabled"];
  for (const field of fields) {
    if (field in ruleToggles && typeof ruleToggles[field] !== "boolean") {
      return fail("rules_invalid", `${field} must be boolean`, field);
    }
  }
  return ok({ ruleToggles });
}

export function validateReplay(body) {
  const events = body?.events;
  if (!Array.isArray(events) || !events.length) {
    return fail("replay_invalid", "events must be a non-empty array", "events");
  }
  for (let i = 0; i < events.length; i += 1) {
    const evt = events[i];
    if (!evt || typeof evt !== "object") {
      return fail("replay_invalid", `event ${i} is invalid`, `events[${i}]`);
    }
    if (typeof evt.type !== "string" || !REPLAY_EVENT_TYPES.has(evt.type)) {
      return fail("replay_invalid", `event ${i} type is not allowed`, `events[${i}].type`);
    }
    if (evt.atISO != null && typeof evt.atISO !== "string") {
      return fail("replay_invalid", `event ${i} atISO must be string`, `events[${i}].atISO`);
    }
  }
  return ok({
    userId: body?.userId,
    initialState: body?.initialState || {},
    events,
  });
}

export function validateDateParam(dateISO, field = "dateISO") {
  if (!isDateISO(dateISO)) {
    return fail("date_invalid", "dateISO must be YYYY-MM-DD", field);
  }
  return ok(dateISO);
}
