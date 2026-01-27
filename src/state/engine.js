import { DECISION_PIPELINE_VERSION } from "../domain/index.js";

export function initialStatePatch() {
  return {
    ruleToggles: {
      constraintsEnabled: true,
      noveltyEnabled: true,
      feedbackEnabled: true,
      badDayEnabled: true,
      recoveryDebtEnabled: true,
      circadianAnchorsEnabled: true,
      safetyEnabled: true,
    },
    eventLog: [],
    feedback: [],
    modifiers: {},
    partCompletionByDate: {},
    selectionStats: { workouts: {}, nutrition: {}, resets: {} },
  };
}

export function reduceEvent(state, event, ctx) {
  const domain = ctx.domain;
  const todayISO = ctx.now?.todayISO || domain.isoToday();
  const ruleToggles = ctx.ruleToggles || initialStatePatch().ruleToggles;
  const qualityRules = buildQualityRules(ruleToggles);
  const params = ctx.params || {};

  let nextState = { ...state };
  let effects = { persist: false };
  let logEvent = null;
  let result = {};

  const ensureUser = () => {
    if (!nextState.userProfile) return null;
    return nextState.userProfile;
  };

  const checkIns = Array.isArray(nextState.checkIns) ? nextState.checkIns : [];
  nextState.selectionStats = ensureSelectionStats(nextState.selectionStats);

  switch (event.type) {
    case "BASELINE_SAVED": {
      const userProfile = event.payload?.userProfile;
      if (!userProfile) return { nextState, effects, logEvent, result };
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
      return { nextState, effects, logEvent, result };
    }

    case "ENSURE_WEEK": {
      const user = ensureUser();
      if (!user) return { nextState, effects, logEvent, result };

      const currentWeekStart = domain.weekStartMonday(todayISO);
      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, todayISO);

      if (!nextState.weekPlan || nextState.weekPlan.startDateISO !== currentWeekStart) {
        const effectiveUser = effectiveUserForDate(user, modifiers, currentWeekStart);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: currentWeekStart,
          checkInsByDate,
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          qualityRules,
          params,
        });
        nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
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
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          modifiers,
          domain,
          qualityRules,
          params,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
          effects.persist = true;
        }
      }

      if (nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(user, nextState.weekPlan, checkInsByDate, domain, params);
      }

      nextState.modifiers = modifiers;
      effects.persist = effects.persist || false;
      return { nextState, effects, logEvent, result };
    }

    case "WEEK_REBUILD": {
      const user = ensureUser();
      if (!user) return { nextState, effects, logEvent, result };
      const weekAnchorISO = event.payload?.weekAnchorISO || todayISO;
      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, weekAnchorISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, weekAnchorISO);

      nextState.weekPlan = domain.generateWeekPlan({
        user: effectiveUser,
        weekAnchorISO,
        checkInsByDate,
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        qualityRules,
        params,
      });
      nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);

      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);
      nextState.modifiers = modifiers;
      effects.persist = true;
      logEvent = {
        type: "week_generated",
        payload: { startDateISO: nextState.weekPlan.startDateISO, pipelineVersion: DECISION_PIPELINE_VERSION },
        atISO: event.atISO,
      };
      return { nextState, effects, logEvent, result };
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
      return { nextState, effects, logEvent, result };
    }

    case "CHECKIN_SAVED": {
      const user = ensureUser();
      const rawCheckIn = event.payload?.checkIn;
      if (!rawCheckIn) return { nextState, effects, logEvent, result };

      const checkIn = normalizeCheckIn({ ...rawCheckIn, atISO: event.atISO || new Date().toISOString() });
      const dataMin = user?.dataMinimization;
      if (dataMin?.enabled) {
        const filtered = checkIns.filter((item) => item.dateISO !== checkIn.dateISO);
        nextState.checkIns = [checkIn, ...filtered].slice(0, 60);
      } else {
        nextState.checkIns = [checkIn, ...checkIns].slice(0, 120);
      }
      const checkInsByDate = buildCheckInsByDate(nextState.checkIns);
      const isBackdated = checkIn.dateISO < todayISO;

      let modifiers = cleanupModifiers(nextState.modifiers || {}, checkIn.dateISO);
      if (user) {
        const effectiveUser = effectiveUserForDate(user, modifiers, checkIn.dateISO);
        const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(
          modifiers,
          checkIn.dateISO,
          ruleToggles
        );

        let generatedWeek = false;
        const weekAnchorISO = domain.weekStartMonday(checkIn.dateISO);
        if (!nextState.weekPlan || (!isBackdated && nextState.weekPlan.startDateISO !== weekAnchorISO)) {
          nextState.weekPlan = domain.generateWeekPlan({
            user: effectiveUser,
            weekAnchorISO: checkIn.dateISO,
            checkInsByDate,
            qualityRules: qualityRulesForDay,
            params,
          });
          generatedWeek = true;
        }

        if (nextState.weekPlan) {
          if (isBackdated) {
            const beforeDay = findDay(nextState.weekPlan, checkIn.dateISO);
            const res = rebuildDayInPlan({
              domain,
              user: effectiveUser,
              weekPlan: nextState.weekPlan,
              dateISO: checkIn.dateISO,
              checkInsByDate,
              completionsByDate: nextState.partCompletionByDate || {},
              feedback: nextState.feedback || [],
              overrides: intensityCap != null ? { intensityCap } : null,
              qualityRules: qualityRulesForDay,
              params,
            });
            nextState.weekPlan = res.weekPlan;
            if (res.dayPlan) {
              nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);
              result = { changedDayISO: checkIn.dateISO, notes: ["Backdated check-in updated"] };
            }
            if (nextState.history && res.dayPlan) {
              nextState.history = addHistoryEntry(nextState.history, {
                reason: "Backdated check-in",
                dateISO: checkIn.dateISO,
                beforeDay,
                afterDay: findDay(nextState.weekPlan, checkIn.dateISO),
              });
            }
          } else {
            const adapted = domain.adaptPlan({
              weekPlan: nextState.weekPlan,
              user: effectiveUser,
              todayISO: checkIn.dateISO,
              checkIn,
              checkInsByDate,
              completionsByDate: nextState.partCompletionByDate || {},
              feedback: nextState.feedback || [],
              overridesBase: intensityCap != null ? { intensityCap } : null,
              qualityRules: qualityRulesForDay,
              weekContextBase: { busyDays: effectiveUser.busyDays || [] },
              params,
            });
            nextState.weekPlan = adapted.weekPlan;
            result = { changedDayISO: adapted.changedDayISO, notes: adapted.notes || [] };
            if (adapted.changedDayISO) {
              const changedDay = findDay(nextState.weekPlan, adapted.changedDayISO);
              nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, changedDay);
            }
          }
        }

        if (generatedWeek && nextState.weekPlan) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
        }

        if (nextState.weekPlan) {
          nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);
        }
      }

      if (nextState.weekPlan && nextState.history && !isBackdated) {
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
      return { nextState, effects, logEvent, result };
    }

    case "QUICK_SIGNAL": {
      const user = ensureUser();
      if (!user || !nextState.weekPlan) return { nextState, effects, logEvent, result };
      const dateISO = event.payload?.dateISO;
      const signal = event.payload?.signal;
      if (!dateISO || !signal) return { nextState, effects, logEvent, result };

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
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        overridesBase: intensityCap != null ? { intensityCap } : null,
        qualityRules: qualityRulesForDay,
        weekContextBase: { busyDays: effectiveUser.busyDays || [] },
        params,
      });
      nextState.weekPlan = adapted.weekPlan;
      result = { changedDayISO: adapted.changedDayISO, notes: adapted.notes || [] };
      if (adapted.changedDayISO) {
        const changedDay = findDay(nextState.weekPlan, adapted.changedDayISO);
        nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, changedDay);
      }
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);
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
      return { nextState, effects, logEvent, result };
    }

    case "STRESSOR_ADDED": {
      const user = ensureUser();
      const dateISO = event.payload?.dateISO;
      const kind = event.payload?.kind;
      if (!dateISO || !kind) return { nextState, effects, logEvent, result };

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
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          overridesBase: intensityCap != null ? { intensityCap } : null,
          qualityRules: qualityRulesForDay,
          weekContextBase: { busyDays: effectiveUser.busyDays || [] },
          params,
        });

        nextState.weekPlan = adapted.weekPlan;
        nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);
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
      return { nextState, effects, logEvent, result };
    }

    case "BAD_DAY_MODE": {
      const user = ensureUser();
      if (!user || !nextState.weekPlan) return { nextState, effects, logEvent, result };
      const dateISO = event.payload?.dateISO;
      if (!dateISO) return { nextState, effects, logEvent, result };

      if (!ruleToggles.badDayEnabled) {
        effects.persist = true;
        logEvent = { type: "bad_day_mode", payload: { dateISO, disabled: true }, atISO: event.atISO };
        return { nextState, effects, logEvent, result };
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
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        overrides: {
          forceBadDayMode: true,
          intensityCap: intensityCap != null ? intensityCap : 2,
        },
        qualityRules: qualityRulesForDay,
        params,
      });
      nextState.weekPlan = res.weekPlan;
      nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);

      if (nextState.history) {
        nextState.history = addHistoryEntry(nextState.history, {
          reason: "Bad day mode",
          dateISO,
          beforeDay,
          afterDay: findDay(nextState.weekPlan, dateISO),
        });
      }

      modifiers.stabilizeTomorrow = true;
      result = { changedDayISO: dateISO, notes: ["Bad day mode applied"] };

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
      return { nextState, effects, logEvent, result };
    }

    case "FEEDBACK_SUBMITTED": {
      const user = ensureUser();
      const dateISO = event.payload?.dateISO;
      const helped = event.payload?.helped;
      const reason = event.payload?.reason;
      if (!user || !nextState.weekPlan || !dateISO) return { nextState, effects, logEvent, result };

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
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          overrides: intensityCap != null ? { intensityCap, source: "feedback" } : { source: "feedback" },
          qualityRules: qualityRulesForDay,
          params,
        });
        nextPlan = res.weekPlan;
        nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);
        if (nextState.history) {
          nextState.history = addHistoryEntry(nextState.history, {
            reason: "Feedback adjustment",
            dateISO: tomorrowISO,
            beforeDay,
            afterDay: findDay(nextPlan, tomorrowISO),
          });
        }
        result = { changedDayISO: tomorrowISO, notes: ["Feedback adjustment"] };
      }

      nextState.weekPlan = nextPlan;
      nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextPlan, checkInsByDate, domain, params);
      nextState.modifiers = modifiers;
      if (reason === "not_relevant") {
        const todayPlan = findDay(nextPlan, dateISO);
        nextState.selectionStats = incrementNotRelevantForDay(nextState.selectionStats, todayPlan);
      }
      effects.persist = true;
      logEvent = { type: "feedback", payload: { dateISO, helped, reason }, atISO: event.atISO };
      return { nextState, effects, logEvent, result };
    }

    case "TOGGLE_PART_COMPLETION": {
      const dateISO = event.payload?.dateISO;
      const part = event.payload?.part;
      if (!dateISO || !part) return { nextState, effects, logEvent, result };

      const current = nextState.partCompletionByDate?.[dateISO] || {};
      const nextValue = !current[part];
      nextState.partCompletionByDate = {
        ...(nextState.partCompletionByDate || {}),
        [dateISO]: { ...current, [part]: nextValue },
      };
      if (nextValue) {
        const dayPlan = findDay(nextState.weekPlan, dateISO);
        nextState.selectionStats = incrementCompletedForDay(nextState.selectionStats, dayPlan, part);
      }

      effects.persist = true;
      logEvent = { type: "completion", payload: { dateISO, part, completed: nextValue }, atISO: event.atISO };
      return { nextState, effects, logEvent, result };
    }

    case "UNDO_LAST_CHANGE": {
      if (!nextState.history || !nextState.history.length || !nextState.weekPlan) {
        return { nextState, effects, logEvent, result };
      }
      const [latest, ...rest] = nextState.history;
      const idx = nextState.weekPlan.days.findIndex((d) => d.dateISO === latest.dateISO);
      if (idx === -1) return { nextState, effects, logEvent, result };

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
          domain,
          params
        );
      }

      effects.persist = true;
      logEvent = { type: "undo_last_change", payload: { dateISO: latest.dateISO }, atISO: event.atISO };
      return { nextState, effects, logEvent, result };
    }

    case "CLEAR_EVENT_LOG": {
      nextState.eventLog = [];
      effects.persist = true;
      return { nextState, effects, logEvent, result };
    }

    case "SET_RULE_TOGGLES": {
      const incoming = event.payload?.ruleToggles || {};
      const base = initialStatePatch().ruleToggles;
      const nextToggles = { ...base, ...(nextState.ruleToggles || {}), ...incoming };
      nextState.ruleToggles = nextToggles;

      const user = ensureUser();
      if (user) {
        const checkInsByDate = buildCheckInsByDate(checkIns);
        const weekAnchorISO = nextState.weekPlan?.startDateISO || domain.weekStartMonday(todayISO);
        const effectiveUser = effectiveUserForDate(user, nextState.modifiers || {}, weekAnchorISO);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO,
          checkInsByDate,
          qualityRules: buildQualityRules(nextToggles),
          params,
        });
        nextState.lastStressStateByDate = buildStressStateMap(effectiveUser, nextState.weekPlan, checkInsByDate, domain, params);
      }

      effects.persist = true;
      logEvent = { type: "rule_toggles", payload: { ruleToggles: nextToggles }, atISO: event.atISO };
      result = { ruleToggles: nextToggles };
      return { nextState, effects, logEvent, result };
    }

    case "APPLY_SCENARIO": {
      const scenarioId = event.payload?.scenarioId;
      if (!scenarioId || !ctx.scenarios) return { nextState, effects, logEvent, result };
      const scenario = ctx.scenarios.getScenarioById ? ctx.scenarios.getScenarioById(scenarioId) : null;
      if (!scenario) return { nextState, effects, logEvent, result };

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
          params,
        });
        nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
      }

      if (user && nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(user, nextState.weekPlan, checkInsByDate, domain, params);
      }

      effects.persist = true;
      logEvent = { type: "scenario_applied", payload: { scenarioId }, atISO: event.atISO };
      return { nextState, effects, logEvent, result };
    }

    default:
      return { nextState, effects, logEvent, result };
  }
}

function buildQualityRules(ruleToggles) {
  return {
    avoidNoveltyWindowDays: ruleToggles.noveltyEnabled === false ? 0 : 2,
    noveltyEnabled: ruleToggles.noveltyEnabled !== false,
    constraintsEnabled: ruleToggles.constraintsEnabled !== false,
    recoveryDebtEnabled: ruleToggles.recoveryDebtEnabled !== false,
    circadianAnchorsEnabled: ruleToggles.circadianAnchorsEnabled !== false,
    safetyEnabled: ruleToggles.safetyEnabled !== false,
  };
}

function buildCheckInsByDate(checkIns) {
  const map = {};
  (checkIns || []).forEach((c) => {
    if (!c?.dateISO) return;
    const existing = map[c.dateISO];
    if (!existing) {
      map[c.dateISO] = c;
      return;
    }
    const existingAt = existing.atISO || "";
    const candidateAt = c.atISO || "";
    if (!existingAt || candidateAt >= existingAt) {
      map[c.dateISO] = c;
    }
  });
  return map;
}

function normalizeCheckIn(checkIn) {
  const atISO = typeof checkIn.atISO === "string" ? checkIn.atISO : new Date().toISOString();
  return {
    ...checkIn,
    atISO,
    stress: Number.isFinite(Number(checkIn.stress)) ? Number(checkIn.stress) : 6,
    sleepQuality: Number.isFinite(Number(checkIn.sleepQuality)) ? Number(checkIn.sleepQuality) : 6,
    energy: Number.isFinite(Number(checkIn.energy)) ? Number(checkIn.energy) : 6,
    timeAvailableMin: Number.isFinite(Number(checkIn.timeAvailableMin)) ? Number(checkIn.timeAvailableMin) : 20,
    illness: Boolean(checkIn.illness),
    injury: Boolean(checkIn.injury),
    panic: Boolean(checkIn.panic),
    fever: Boolean(checkIn.fever),
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

function normalizePlanPipeline({
  user,
  weekPlan,
  checkInsByDate,
  completionsByDate,
  feedback,
  modifiers,
  domain,
  qualityRules,
  params,
}) {
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
        completionsByDate,
        feedback,
        weekContext: { busyDays: effectiveUser.busyDays || [], recentNoveltyGroups },
        overrides: intensityCap != null ? { intensityCap } : null,
        qualityRules: rulesForDay,
        params,
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

function rebuildDayInPlan({
  domain,
  user,
  weekPlan,
  dateISO,
  checkInsByDate,
  completionsByDate,
  feedback,
  overrides,
  qualityRules,
  params,
}) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, dayPlan: null };

  const recentNoveltyGroups = collectRecentNoveltyGroups(weekPlan.days, idx, 2);
  const { dayPlan } = domain.buildDayPlan({
    user,
    dateISO,
    checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
    checkInsByDate,
    completionsByDate,
    feedback,
    weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups },
    overrides,
    qualityRules,
    params,
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

function buildStressStateMap(user, plan, checkInsByDate, domain, params) {
  const map = {};
  plan.days.forEach((day) => {
    const checkIn = checkInsByDate ? checkInsByDate[day.dateISO] : undefined;
    const stressState = domain.assignStressProfile({ user, dateISO: day.dateISO, checkIn, params });
    if (typeof domain.computeRecoveryDebt === "function") {
      stressState.recoveryDebt = domain.computeRecoveryDebt(checkInsByDate, day.dateISO, params);
    }
    map[day.dateISO] = stressState;
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

function ensureSelectionStats(stats) {
  return {
    workouts: stats?.workouts || {},
    nutrition: stats?.nutrition || {},
    resets: stats?.resets || {},
  };
}

function bumpSelection(stats, category, id, field) {
  if (!id) return stats;
  const next = {
    ...stats,
    [category]: { ...(stats[category] || {}) },
  };
  const current = next[category][id] || { picked: 0, completed: 0, notRelevant: 0 };
  next[category][id] = { ...current, [field]: (current[field] || 0) + 1 };
  return next;
}

function incrementPickedForDay(stats, dayPlan) {
  const selected = dayPlan?.meta?.selected;
  if (!selected) return stats;
  let next = ensureSelectionStats(stats);
  next = bumpSelection(next, "workouts", selected.workoutId, "picked");
  next = bumpSelection(next, "nutrition", selected.nutritionId, "picked");
  next = bumpSelection(next, "resets", selected.resetId, "picked");
  return next;
}

function incrementPickedForWeek(stats, weekPlan) {
  if (!weekPlan?.days) return stats;
  let next = ensureSelectionStats(stats);
  weekPlan.days.forEach((day) => {
    next = incrementPickedForDay(next, day);
  });
  return next;
}

function incrementCompletedForDay(stats, dayPlan, part) {
  const selected = dayPlan?.meta?.selected;
  if (!selected) return stats;
  if (part === "workout") return bumpSelection(stats, "workouts", selected.workoutId, "completed");
  if (part === "nutrition") return bumpSelection(stats, "nutrition", selected.nutritionId, "completed");
  if (part === "reset") return bumpSelection(stats, "resets", selected.resetId, "completed");
  return stats;
}

function incrementNotRelevantForDay(stats, dayPlan) {
  const selected = dayPlan?.meta?.selected;
  if (!selected) return stats;
  let next = stats;
  next = bumpSelection(next, "workouts", selected.workoutId, "notRelevant");
  next = bumpSelection(next, "nutrition", selected.nutritionId, "notRelevant");
  next = bumpSelection(next, "resets", selected.resetId, "notRelevant");
  return next;
}
