import { DECISION_PIPELINE_VERSION } from "../domain";

export function initialStatePatch() {
  return {
    ruleToggles: {
      constraintsEnabled: true,
      noveltyEnabled: true,
      feedbackEnabled: true,
      badDayEnabled: true,
    },
    eventLog: [],
    feedback: [],
    modifiers: {},
    partCompletionByDate: {},
  };
}

export function reduceEvent(state, event, ctx) {
  const domain = ctx.domain;
  const todayISO = ctx.now?.todayISO || domain.isoToday();
  const ruleToggles = ctx.ruleToggles || initialStatePatch().ruleToggles;
  const qualityRules = buildQualityRules(ruleToggles);

  let nextState = { ...state };
  let effects = { persist: false };
  let logEvent = null;

  const ensureUser = () => {
    if (!nextState.userProfile) return null;
    return nextState.userProfile;
  };

  const checkIns = Array.isArray(nextState.checkIns) ? nextState.checkIns : [];

  switch (event.type) {
    case "BASELINE_SAVED": {
      const userProfile = event.payload?.userProfile;
      if (!userProfile) return { nextState, effects, logEvent };
      nextState.userProfile = userProfile;
      effects.persist = true;
      logEvent = {
        type: "baseline_saved",
        payload: {
          hasBusyDays: Array.isArray(userProfile.busyDays) && userProfile.busyDays.length > 0,
          preferredWindows: userProfile.preferredWorkoutWindows || [],
          timeDefaults: userProfile.constraints?.timePerDayMin ?? userProfile.timePerDayMin ?? null,
        },
        atISO: event.atISO,
      };
      return { nextState, effects, logEvent };
    }

    case "ENSURE_WEEK": {
      const user = ensureUser();
      if (!user) return { nextState, effects, logEvent };

      const currentWeekStart = domain.weekStartMonday(todayISO);
      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, todayISO);

      if (!nextState.weekPlan || nextState.weekPlan.startDateISO !== currentWeekStart) {
        const effectiveUser = effectiveUserForDate(user, modifiers, currentWeekStart);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: currentWeekStart,
          checkInsByDate,
          qualityRules,
        });
        effects.persist = true;
        logEvent = {
          type: "week_generated",
          payload: { startDateISO: nextState.weekPlan.startDateISO, pipelineVersion: DECISION_PIPELINE_VERSION },
          atISO: event.atISO,
        };
      }

      if (nextState.weekPlan) {
        const normalized = normalizePlanPipeline({
          user,
          weekPlan: nextState.weekPlan,
          checkInsByDate,
          modifiers,
          domain,
          qualityRules,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) effects.persist = true;
      }

      if (nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(user, nextState.weekPlan, checkInsByDate, domain);
      }

      nextState.modifiers = modifiers;
      effects.persist = effects.persist || false;
      return { nextState, effects, logEvent };
    }

    case "WEEK_REBUILD": {
      const user = ensureUser();
      if (!user) return { nextState, effects, logEvent };
      const weekAnchorISO = event.payload?.weekAnchorISO || todayISO;
      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, weekAnchorISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, weekAnchorISO);

      nextState.weekPlan = domain.generateWeekPlan({
        user: effectiveUser,
        weekAnchorISO,
        checkInsByDate,
        qualityRules,
      });

      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain);
      nextState.modifiers = modifiers;
      effects.persist = true;
      logEvent = {
        type: "week_generated",
        payload: { startDateISO: nextState.weekPlan.startDateISO, pipelineVersion: DECISION_PIPELINE_VERSION },
        atISO: event.atISO,
      };
      return { nextState, effects, logEvent };
    }

    case "DAY_VIEWED": {
      logEvent = {
        type: "day_viewed",
        payload: {
          dateISO: event.payload?.dateISO,
          pipelineVersion: event.payload?.pipelineVersion,
          appliedRules: event.payload?.appliedRules || [],
        },
        atISO: event.atISO,
      };
      effects.persist = true;
      return { nextState, effects, logEvent };
    }

    case "CHECKIN_SAVED": {
      const user = ensureUser();
      const rawCheckIn = event.payload?.checkIn;
      if (!rawCheckIn) return { nextState, effects, logEvent };

      const checkIn = normalizeCheckIn(rawCheckIn);
      const filtered = checkIns.filter((item) => item.dateISO !== checkIn.dateISO);
      nextState.checkIns = [checkIn, ...filtered].slice(0, 60);
      const checkInsByDate = buildCheckInsByDate(nextState.checkIns);

      let modifiers = cleanupModifiers(nextState.modifiers || {}, checkIn.dateISO);
      if (user) {
        const effectiveUser = effectiveUserForDate(user, modifiers, checkIn.dateISO);
        const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, checkIn.dateISO, ruleToggles);

        if (!nextState.weekPlan || nextState.weekPlan.startDateISO !== domain.weekStartMonday(checkIn.dateISO)) {
          nextState.weekPlan = domain.generateWeekPlan({
            user: effectiveUser,
            weekAnchorISO: checkIn.dateISO,
            checkInsByDate,
            qualityRules: qualityRulesForDay,
          });
        }

        if (nextState.weekPlan) {
          const adapted = domain.adaptPlan({
            weekPlan: nextState.weekPlan,
            user: effectiveUser,
            todayISO: checkIn.dateISO,
            checkIn,
            checkInsByDate,
            overridesBase: intensityCap != null ? { intensityCap } : null,
            qualityRules: qualityRulesForDay,
            weekContextBase: { busyDays: effectiveUser.busyDays || [] },
          });
          nextState.weekPlan = adapted.weekPlan;
        }

        if (nextState.weekPlan) {
          nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain);
        }
      }

      if (nextState.weekPlan && nextState.history) {
        nextState.history = addHistoryEntry(nextState.history, {
          reason: "Check-in update",
          dateISO: checkIn.dateISO,
          beforeDay: findDay(state.weekPlan, checkIn.dateISO),
          afterDay: findDay(nextState.weekPlan, checkIn.dateISO),
        });
        if (checkIn.stress >= 7 && checkIn.sleepQuality <= 5) {
          const tomorrowISO = domain.addDaysISO(checkIn.dateISO, 1);
          nextState.history = addHistoryEntry(nextState.history, {
            reason: "Tomorrow adjusted for high stress + poor sleep",
            dateISO: tomorrowISO,
            beforeDay: findDay(state.weekPlan, tomorrowISO),
            afterDay: findDay(nextState.weekPlan, tomorrowISO),
          });
        }
      }

      nextState.modifiers = modifiers;
      effects.persist = true;
      logEvent = {
        type: "checkin_saved",
        payload: {
          dateISO: checkIn.dateISO,
          stress: checkIn.stress,
          sleepQuality: checkIn.sleepQuality,
          energy: checkIn.energy,
          timeAvailableMin: checkIn.timeAvailableMin,
        },
        atISO: event.atISO,
      };
      return { nextState, effects, logEvent };
    }

    case "QUICK_SIGNAL": {
      const user = ensureUser();
      if (!user || !nextState.weekPlan) return { nextState, effects, logEvent };
      const dateISO = event.payload?.dateISO;
      const signal = event.payload?.signal;
      if (!dateISO || !signal) return { nextState, effects, logEvent };

      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO);
      const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

      const adapted = domain.adaptPlan({
        weekPlan: nextState.weekPlan,
        user: effectiveUser,
        todayISO: dateISO,
        signal,
        checkInsByDate,
        overridesBase: intensityCap != null ? { intensityCap } : null,
        qualityRules: qualityRulesForDay,
        weekContextBase: { busyDays: effectiveUser.busyDays || [] },
      });
      nextState.weekPlan = adapted.weekPlan;
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain);
      nextState.modifiers = modifiers;

      if (nextState.weekPlan && nextState.history) {
        nextState.history = addHistoryEntry(nextState.history, {
          reason: `Signal: ${signal}`,
          dateISO,
          beforeDay: findDay(state.weekPlan, dateISO),
          afterDay: findDay(nextState.weekPlan, dateISO),
        });
      }

      effects.persist = true;
      logEvent = { type: "quick_signal", payload: { dateISO, signal }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    case "STRESSOR_ADDED": {
      const user = ensureUser();
      const dateISO = event.payload?.dateISO;
      const kind = event.payload?.kind;
      if (!dateISO || !kind) return { nextState, effects, logEvent };

      const existing = (nextState.stressors || []).some((s) => s.dateISO === dateISO && s.kind === kind);
      if (!existing) {
        nextState.stressors = [
          { id: Math.random().toString(36).slice(2), dateISO, kind },
          ...(nextState.stressors || []),
        ];
      }

      if (user && nextState.weekPlan) {
        const checkInsByDate = buildCheckInsByDate(checkIns);
        const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
        const effectiveUser = effectiveUserForDate(user, modifiers, dateISO);
        const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

        const adapted = domain.adaptPlan({
          weekPlan: nextState.weekPlan,
          user: effectiveUser,
          todayISO: dateISO,
          signal: "im_stressed",
          checkInsByDate,
          overridesBase: intensityCap != null ? { intensityCap } : null,
          qualityRules: qualityRulesForDay,
          weekContextBase: { busyDays: effectiveUser.busyDays || [] },
        });

        nextState.weekPlan = adapted.weekPlan;
        nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain);
        nextState.modifiers = modifiers;

        if (nextState.history) {
          nextState.history = addHistoryEntry(nextState.history, {
            reason: `Stressor: ${kind}`,
            dateISO,
            beforeDay: findDay(state.weekPlan, dateISO),
            afterDay: findDay(nextState.weekPlan, dateISO),
          });
        }
      }

      effects.persist = true;
      logEvent = { type: "quick_signal", payload: { dateISO, signal: "im_stressed", kind }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    case "BAD_DAY_MODE": {
      const user = ensureUser();
      if (!user || !nextState.weekPlan) return { nextState, effects, logEvent };
      const dateISO = event.payload?.dateISO;
      if (!dateISO) return { nextState, effects, logEvent };

      if (!ruleToggles.badDayEnabled) {
        effects.persist = true;
        logEvent = { type: "bad_day_mode", payload: { dateISO, disabled: true }, atISO: event.atISO };
        return { nextState, effects, logEvent };
      }

      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO);
      const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

      const beforeDay = findDay(nextState.weekPlan, dateISO);
      const res = rebuildDayInPlan({
        domain,
        user: effectiveUser,
        weekPlan: nextState.weekPlan,
        dateISO,
        checkInsByDate,
        overrides: {
          forceBadDayMode: true,
          intensityCap: intensityCap != null ? intensityCap : 2,
        },
        qualityRules: qualityRulesForDay,
      });
      nextState.weekPlan = res.weekPlan;
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain);

      if (nextState.history) {
        nextState.history = addHistoryEntry(nextState.history, {
          reason: "Bad day mode",
          dateISO,
          beforeDay,
          afterDay: findDay(nextState.weekPlan, dateISO),
        });
      }

      modifiers.stabilizeTomorrow = true;

      let autoEvent = null;
      if (hasBadDayYesterday(state.eventLog || [], dateISO, domain)) {
        modifiers.stabilizeTomorrow = true;
        modifiers.intensityCapValue = 3;
        modifiers.intensityCapUntilISO = domain.addDaysISO(dateISO, 3);
        autoEvent = { type: "auto_stabilize_after_bad_days", payload: { dateISO }, atISO: event.atISO };
      }

      nextState.modifiers = modifiers;
      effects.persist = true;
      logEvent = [
        { type: "bad_day_mode", payload: { dateISO }, atISO: event.atISO },
        autoEvent,
      ].filter(Boolean);
      return { nextState, effects, logEvent };
    }

    case "FEEDBACK_SUBMITTED": {
      const user = ensureUser();
      const dateISO = event.payload?.dateISO;
      const helped = event.payload?.helped;
      const reason = event.payload?.reason;
      if (!user || !nextState.weekPlan || !dateISO) return { nextState, effects, logEvent };

      const feedbackEntry = {
        id: Math.random().toString(36).slice(2),
        dateISO,
        helped,
        reason: reason || undefined,
        atISO: event.atISO,
      };
      nextState.feedback = [feedbackEntry, ...(nextState.feedback || [])].slice(0, 120);

      let modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
      if (ruleToggles.feedbackEnabled) {
        if (reason === "too_hard") {
          modifiers.intensityCapValue = 3;
          modifiers.intensityCapUntilISO = domain.addDaysISO(dateISO, 3);
        } else if (reason === "too_easy") {
          delete modifiers.intensityCapValue;
          delete modifiers.intensityCapUntilISO;
        } else if (reason === "wrong_time") {
          const day = findDay(nextState.weekPlan, dateISO);
          const currentWindow = day?.workoutWindow || "AM";
          modifiers.preferredWindowBias = nextWindowFrom(currentWindow);
          modifiers.preferredWindowBiasUntilISO = domain.addDaysISO(dateISO, 7);
        } else if (reason === "not_relevant") {
          modifiers.noveltyRotationBoost = true;
          modifiers.noveltyRotationBoostUntilISO = domain.addDaysISO(dateISO, 7);
        }
      }

      const checkInsByDate = buildCheckInsByDate(checkIns);
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO);

      let nextPlan = nextState.weekPlan;
      if (nextPlan.days.some((d) => d.dateISO === domain.addDaysISO(dateISO, 1))) {
        const tomorrowISO = domain.addDaysISO(dateISO, 1);
        const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, tomorrowISO, ruleToggles);
        const beforeDay = findDay(nextPlan, tomorrowISO);
        const res = rebuildDayInPlan({
          domain,
          user: effectiveUser,
          weekPlan: nextPlan,
          dateISO: tomorrowISO,
          checkInsByDate,
          overrides: intensityCap != null ? { intensityCap } : null,
          qualityRules: qualityRulesForDay,
        });
        nextPlan = res.weekPlan;
        if (nextState.history) {
          nextState.history = addHistoryEntry(nextState.history, {
            reason: "Feedback adjustment",
            dateISO: tomorrowISO,
            beforeDay,
            afterDay: findDay(nextPlan, tomorrowISO),
          });
        }
      }

      nextState.weekPlan = nextPlan;
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextPlan, checkInsByDate, domain);
      nextState.modifiers = modifiers;
      effects.persist = true;
      logEvent = { type: "feedback", payload: { dateISO, helped, reason }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    case "TOGGLE_PART_COMPLETION": {
      const dateISO = event.payload?.dateISO;
      const part = event.payload?.part;
      if (!dateISO || !part) return { nextState, effects, logEvent };

      const current = nextState.partCompletionByDate?.[dateISO] || {};
      const nextValue = !current[part];
      nextState.partCompletionByDate = {
        ...(nextState.partCompletionByDate || {}),
        [dateISO]: { ...current, [part]: nextValue },
      };

      effects.persist = true;
      logEvent = { type: "completion", payload: { dateISO, part, completed: nextValue }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    case "UNDO_LAST_CHANGE": {
      if (!nextState.history || !nextState.history.length || !nextState.weekPlan) {
        return { nextState, effects, logEvent };
      }
      const [latest, ...rest] = nextState.history;
      const idx = nextState.weekPlan.days.findIndex((d) => d.dateISO === latest.dateISO);
      if (idx === -1) return { nextState, effects, logEvent };

      const nextDays = nextState.weekPlan.days.slice();
      nextDays[idx] = latest.beforeDay;
      nextState.weekPlan = { ...nextState.weekPlan, days: nextDays };
      nextState.history = rest;

      if (nextState.userProfile) {
        const checkInsByDate = buildCheckInsByDate(checkIns);
        nextState.lastStressStateByDate = buildStressStateMap(
          nextState.userProfile,
          nextState.weekPlan,
          checkInsByDate,
          domain
        );
      }

      effects.persist = true;
      logEvent = { type: "undo_last_change", payload: { dateISO: latest.dateISO }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    case "CLEAR_EVENT_LOG": {
      nextState.eventLog = [];
      effects.persist = true;
      return { nextState, effects, logEvent };
    }

    case "APPLY_SCENARIO": {
      const scenarioId = event.payload?.scenarioId;
      if (!scenarioId || !ctx.scenarios) return { nextState, effects, logEvent };
      const scenario = ctx.scenarios.getScenarioById ? ctx.scenarios.getScenarioById(scenarioId) : null;
      if (!scenario) return { nextState, effects, logEvent };

      const patch = scenario.seed(state, ctx) || {};
      nextState = { ...nextState, ...patch };

      const user = ensureUser();
      const checkInsByDate = buildCheckInsByDate(nextState.checkIns || []);
      if (user && (!nextState.weekPlan || nextState.weekPlan.startDateISO !== domain.weekStartMonday(todayISO))) {
        nextState.weekPlan = domain.generateWeekPlan({
          user,
          weekAnchorISO: todayISO,
          checkInsByDate,
          qualityRules,
        });
      }

      if (user && nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(user, nextState.weekPlan, checkInsByDate, domain);
      }

      effects.persist = true;
      logEvent = { type: "scenario_applied", payload: { scenarioId }, atISO: event.atISO };
      return { nextState, effects, logEvent };
    }

    default:
      return { nextState, effects, logEvent };
  }
}

function buildQualityRules(ruleToggles) {
  return {
    avoidNoveltyWindowDays: ruleToggles.noveltyEnabled === false ? 0 : 2,
    noveltyEnabled: ruleToggles.noveltyEnabled !== false,
    constraintsEnabled: ruleToggles.constraintsEnabled !== false,
  };
}

function buildCheckInsByDate(checkIns) {
  const map = {};
  (checkIns || []).forEach((c) => {
    map[c.dateISO] = c;
  });
  return map;
}

function normalizeCheckIn(checkIn) {
  return {
    ...checkIn,
    stress: Number.isFinite(Number(checkIn.stress)) ? Number(checkIn.stress) : 6,
    sleepQuality: Number.isFinite(Number(checkIn.sleepQuality)) ? Number(checkIn.sleepQuality) : 6,
    energy: Number.isFinite(Number(checkIn.energy)) ? Number(checkIn.energy) : 6,
    timeAvailableMin: Number.isFinite(Number(checkIn.timeAvailableMin)) ? Number(checkIn.timeAvailableMin) : 20,
  };
}

function cleanupModifiers(modifiers, todayISO) {
  const next = { ...(modifiers || {}) };
  if (next.intensityCapUntilISO && todayISO > next.intensityCapUntilISO) {
    delete next.intensityCapUntilISO;
    delete next.intensityCapValue;
  }
  if (next.preferredWindowBiasUntilISO && todayISO > next.preferredWindowBiasUntilISO) {
    delete next.preferredWindowBiasUntilISO;
    delete next.preferredWindowBias;
  }
  if (next.noveltyRotationBoostUntilISO && todayISO > next.noveltyRotationBoostUntilISO) {
    delete next.noveltyRotationBoostUntilISO;
    next.noveltyRotationBoost = false;
  }
  return next;
}

function effectiveUserForDate(user, modifiers, dateISO) {
  if (!user) return user;
  const mod = modifiers || {};
  const biasActive = mod.preferredWindowBias && isActiveUntil(dateISO, mod.preferredWindowBiasUntilISO);
  if (!biasActive) return user;
  const windows = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
  const nextWindows = [mod.preferredWindowBias, ...windows.filter((w) => w !== mod.preferredWindowBias)];
  return { ...user, preferredWorkoutWindows: nextWindows };
}

function modifiersForDate(modifiers, dateISO, ruleToggles) {
  const mod = modifiers || {};
  const intensityActive = mod.intensityCapValue != null && isActiveUntil(dateISO, mod.intensityCapUntilISO);
  const noveltyActive = mod.noveltyRotationBoost && isActiveUntil(dateISO, mod.noveltyRotationBoostUntilISO);
  const noveltyEnabled = ruleToggles.noveltyEnabled !== false;
  return {
    intensityCap: intensityActive ? mod.intensityCapValue : null,
    qualityRules: {
      avoidNoveltyWindowDays: noveltyEnabled ? (noveltyActive ? 3 : 2) : 0,
      noveltyEnabled,
      constraintsEnabled: ruleToggles.constraintsEnabled !== false,
    },
  };
}

function normalizePlanPipeline({ user, weekPlan, checkInsByDate, modifiers, domain, qualityRules }) {
  const nextDays = [];
  let changed = false;

  for (let i = 0; i < weekPlan.days.length; i += 1) {
    const day = weekPlan.days[i];
    if (day.pipelineVersion !== DECISION_PIPELINE_VERSION) {
      const dateISO = day.dateISO;
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO);
      const recentNoveltyGroups = collectRecentNoveltyGroups(nextDays, nextDays.length, 2);
      const { intensityCap, qualityRules: rulesForDay } = modifiersForDate(modifiers, dateISO, { noveltyEnabled: qualityRules.noveltyEnabled, constraintsEnabled: qualityRules.constraintsEnabled });
      const { dayPlan } = domain.buildDayPlan({
        user: effectiveUser,
        dateISO,
        checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
        checkInsByDate,
        weekContext: { busyDays: effectiveUser.busyDays || [], recentNoveltyGroups },
        overrides: intensityCap != null ? { intensityCap } : null,
        qualityRules: rulesForDay,
      });
      nextDays.push(dayPlan);
      changed = true;
    } else {
      nextDays.push(day);
    }
  }

  if (!changed) return { weekPlan, changed: false };
  return { weekPlan: { ...weekPlan, days: nextDays }, changed: true };
}

function rebuildDayInPlan({ domain, user, weekPlan, dateISO, checkInsByDate, overrides, qualityRules }) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, dayPlan: null };

  const recentNoveltyGroups = collectRecentNoveltyGroups(weekPlan.days, idx, 2);
  const { dayPlan } = domain.buildDayPlan({
    user,
    dateISO,
    checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
    checkInsByDate,
    weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups },
    overrides,
    qualityRules,
  });

  const nextDays = weekPlan.days.slice();
  nextDays[idx] = dayPlan;
  return { weekPlan: { ...weekPlan, days: nextDays }, dayPlan };
}

function addHistoryEntry(history, { reason, dateISO, beforeDay, afterDay }) {
  if (!beforeDay || !afterDay) return history;
  if (JSON.stringify(beforeDay) === JSON.stringify(afterDay)) return history;
  const entry = {
    id: Math.random().toString(36).slice(2),
    atISO: new Date().toISOString(),
    reason,
    dateISO,
    beforeDay: deepClone(beforeDay),
    afterDay: deepClone(afterDay),
  };
  return [entry, ...history].slice(0, 50);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findDay(plan, dateISO) {
  return plan?.days?.find((d) => d.dateISO === dateISO) || null;
}

function buildStressStateMap(user, plan, checkInsByDate, domain) {
  const map = {};
  plan.days.forEach((day) => {
    const checkIn = checkInsByDate ? checkInsByDate[day.dateISO] : undefined;
    map[day.dateISO] = domain.assignStressProfile({ user, dateISO: day.dateISO, checkIn });
  });
  return map;
}

function collectRecentNoveltyGroups(days, idx, windowDays) {
  const start = Math.max(0, idx - windowDays);
  const recent = days.slice(start, idx);
  const groups = [];
  recent.forEach((day) => {
    if (day.selectedNoveltyGroups) {
      Object.values(day.selectedNoveltyGroups).forEach((g) => {
        if (g) groups.push(g);
      });
    } else {
      if (day.workout?.noveltyGroup) groups.push(day.workout.noveltyGroup);
      if (day.nutrition?.noveltyGroup) groups.push(day.nutrition.noveltyGroup);
      if (day.reset?.noveltyGroup) groups.push(day.reset.noveltyGroup);
    }
  });
  return groups;
}

function isActiveUntil(dateISO, untilISO) {
  if (!untilISO) return true;
  return dateISO <= untilISO;
}

function nextWindowFrom(current) {
  const cycle = ["AM", "MIDDAY", "PM"];
  const idx = cycle.indexOf(current);
  if (idx === -1) return "AM";
  return cycle[(idx + 1) % cycle.length];
}

function hasBadDayYesterday(eventLog, todayISO, domain) {
  const yesterdayISO = domain.addDaysISO(todayISO, -1);
  return (eventLog || []).some((e) => e.type === "bad_day_mode" && e.payload?.dateISO === yesterdayISO);
}
