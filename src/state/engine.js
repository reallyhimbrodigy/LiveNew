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
    reEntry: null,
  };
}

export function reduceEvent(state, event, ctx) {
  const domain = ctx.domain;
  const todayISO = ctx.now?.todayISO || domain.isoToday();
  const ruleToggles = ctx.ruleToggles || initialStatePatch().ruleToggles;
  const qualityRules = buildQualityRules(ruleToggles);
  const params = ctx.params || {};
  const regenPolicy = ctx.regenPolicy || {};
  const ruleConfig = ctx.ruleConfig || {};
  const packOverride = ctx.packOverride || null;
  const experimentMeta = ctx.experimentMeta || null;
  const engineGuards = ctx.engineGuards || {};
  const reEntryEnabled = engineGuards.reentryEnabled !== false;
  const baseOverrides = experimentMeta ? { experimentMeta } : null;
  const withBaseOverrides = (overrides) => {
    if (!baseOverrides) return overrides;
    if (!overrides) return { ...baseOverrides };
    return { ...overrides, ...baseOverrides };
  };

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
  const expiredReEntry = expireReEntry(nextState.reEntry, todayISO, domain, reEntryEnabled, event.atISO);
  if (expiredReEntry.changed) {
    nextState.reEntry = expiredReEntry.value;
    effects.persist = true;
  }

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

    case "LAST_ACTIVE_TOUCHED": {
      const userProfile = ensureUser();
      if (!userProfile) return { nextState, effects, logEvent, result };
      const atISO = event.atISO || new Date().toISOString();
      nextState.userProfile = { ...userProfile, lastActiveAtISO: atISO };
      effects.persist = true;
      return { nextState, effects, logEvent, result };
    }

    case "REENTRY_STARTED": {
      if (reEntryEnabled === false) return { nextState, effects, logEvent, result };
      const startDateISO = event.payload?.startDateISO || todayISO;
      const atISO = event.atISO || new Date().toISOString();
      nextState.reEntry = {
        active: true,
        startedAtISO: atISO,
        startDateISO,
        dayIndex: 1,
        lastAdvancedDateISO: startDateISO,
      };
      if (nextState.weekPlan) {
        const checkInsByDate = buildCheckInsByDate(checkIns);
        const modifiers = cleanupModifiers(nextState.modifiers || {}, todayISO);
        const reEntryDays = reEntryDates(nextState.reEntry, todayISO, domain, engineGuards);
        let updatedPlan = nextState.weekPlan;
        reEntryDays.forEach((dateISO) => {
          const res = rebuildDayInPlan({
            domain,
            user: effectiveUserForDate(nextState.userProfile, modifiers, dateISO, packOverride),
            weekPlan: updatedPlan,
            dateISO,
            todayISO,
            checkInsByDate,
            completionsByDate: nextState.partCompletionByDate || {},
            feedback: nextState.feedback || [],
            overrides: withBaseOverrides(null),
            qualityRules,
            params,
            packOverride,
            ruleConfig,
            baseOverrides,
            reEntry: nextState.reEntry,
            engineGuards,
          });
          updatedPlan = res.weekPlan;
          if (res.dayPlan) {
            nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);
          }
        });
        nextState.weekPlan = updatedPlan;
        if (nextState.weekPlan) {
          nextState.lastStressStateByDate = buildStressStateMap(
            nextState.userProfile,
            nextState.weekPlan,
            checkInsByDate,
            domain,
            params,
            packOverride
          );
        }
      }
      effects.persist = true;
      logEvent = { type: "reentry_started", payload: { startDateISO }, atISO: event.atISO };
      result = { reEntry: nextState.reEntry };
      return { nextState, effects, logEvent, result };
    }

    case "REENTRY_ADVANCED": {
      if (reEntryEnabled === false) return { nextState, effects, logEvent, result };
      const dateISO = event.payload?.dateISO || todayISO;
      if (!isReEntryActiveForDate(nextState.reEntry, dateISO, todayISO, domain, engineGuards)) {
        return { nextState, effects, logEvent, result };
      }
      const advanced = advanceReEntry(nextState.reEntry, dateISO);
      if (advanced.changed) {
        nextState.reEntry = advanced.value;
        effects.persist = true;
        logEvent = { type: "reentry_advanced", payload: { dateISO, dayIndex: nextState.reEntry.dayIndex }, atISO: event.atISO };
      }
      return { nextState, effects, logEvent, result };
    }

    case "ENSURE_WEEK": {
      const user = ensureUser();
      if (!user) return { nextState, effects, logEvent, result };

      const currentWeekStart = domain.weekStartMonday(todayISO);
      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, todayISO);
      const prevWeekPlan = nextState.weekPlan;

      if (!nextState.weekPlan || nextState.weekPlan.startDateISO !== currentWeekStart) {
        const effectiveUser = effectiveUserForDate(user, modifiers, currentWeekStart, packOverride);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: currentWeekStart,
          checkInsByDate,
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          qualityRules,
          params,
          ruleConfig,
          overridesBase: withBaseOverrides(null),
        });
        nextState.weekPlan = freezePastDays(prevWeekPlan, nextState.weekPlan, todayISO);
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
          todayISO,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
          effects.persist = true;
        }
      }

      if (nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(user, nextState.weekPlan, checkInsByDate, domain, params, packOverride);
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
      const effectiveUser = effectiveUserForDate(user, modifiers, weekAnchorISO, packOverride);
      const prevWeekPlan = nextState.weekPlan;

      nextState.weekPlan = domain.generateWeekPlan({
        user: effectiveUser,
        weekAnchorISO,
        checkInsByDate,
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        qualityRules,
        params,
        ruleConfig,
        overridesBase: withBaseOverrides(null),
      });
      nextState.weekPlan = freezePastDays(prevWeekPlan, nextState.weekPlan, todayISO);
      nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);

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
        todayISO,
        packOverride,
        ruleConfig,
        baseOverrides,
        reEntry: nextState.reEntry,
        engineGuards,
      });
      nextState.weekPlan = normalized.weekPlan;
      if (normalized.changed) {
        nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
      }

      nextState.lastStressStateByDate = buildStressStateMap(
        effectiveUser,
        nextState.weekPlan,
        checkInsByDate,
        domain,
        params,
        packOverride
      );
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
      if (isReEntryActiveForDate(nextState.reEntry, checkIn.dateISO, todayISO, domain, engineGuards)) {
        const advanced = advanceReEntry(nextState.reEntry, checkIn.dateISO);
        if (advanced.changed) {
          nextState.reEntry = advanced.value;
          effects.persist = true;
        }
      }

      let modifiers = cleanupModifiers(nextState.modifiers || {}, checkIn.dateISO);
      if (user) {
        const effectiveUser = effectiveUserForDate(user, modifiers, checkIn.dateISO, packOverride);
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
            ruleConfig,
            overridesBase: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
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
              todayISO,
              checkInsByDate,
              completionsByDate: nextState.partCompletionByDate || {},
              feedback: nextState.feedback || [],
              overrides: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
              qualityRules: qualityRulesForDay,
              params,
              packOverride,
              ruleConfig,
              baseOverrides,
              reEntry: nextState.reEntry,
              engineGuards,
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
            const reEntryOverridesFor = (targetDateISO) =>
              reEntryOverridesForDate(nextState.reEntry, targetDateISO, todayISO, domain, engineGuards);
            const adapted = domain.adaptPlan({
              weekPlan: nextState.weekPlan,
              user: effectiveUser,
              todayISO: checkIn.dateISO,
              checkIn,
              checkInsByDate,
              completionsByDate: nextState.partCompletionByDate || {},
              feedback: nextState.feedback || [],
              overridesBase: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
              overridesForDate: reEntryOverridesFor,
              qualityRules: qualityRulesForDay,
              weekContextBase: { busyDays: effectiveUser.busyDays || [] },
              params,
              ruleConfig,
              library: domain.defaultLibrary,
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

        if (nextState.weekPlan && nextState.reEntry?.active) {
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
            todayISO,
            packOverride,
            ruleConfig,
            baseOverrides,
            reEntry: nextState.reEntry,
            engineGuards,
          });
          nextState.weekPlan = normalized.weekPlan;
          if (normalized.changed) {
            nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
          }
        }

        if (nextState.weekPlan) {
          nextState.lastStressStateByDate = buildStressStateMap(
            effectiveUser,
            nextState.weekPlan,
            checkInsByDate,
            domain,
            params,
            packOverride
          );
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
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);
      const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

      const reEntryOverridesFor = (targetDateISO) =>
        reEntryOverridesForDate(nextState.reEntry, targetDateISO, todayISO, domain, engineGuards);
      const adapted = domain.adaptPlan({
        weekPlan: nextState.weekPlan,
        user: effectiveUser,
        todayISO: dateISO,
        signal,
        checkInsByDate,
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        overridesBase: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
        overridesForDate: reEntryOverridesFor,
        qualityRules: qualityRulesForDay,
        weekContextBase: { busyDays: effectiveUser.busyDays || [] },
        params,
        ruleConfig,
        library: domain.defaultLibrary,
      });
      nextState.weekPlan = adapted.weekPlan;
      result = { changedDayISO: adapted.changedDayISO, notes: adapted.notes || [] };
      if (adapted.changedDayISO) {
        const changedDay = findDay(nextState.weekPlan, adapted.changedDayISO);
        nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, changedDay);
      }

      if (nextState.weekPlan && nextState.reEntry?.active) {
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
          todayISO,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
        }
      }
      nextState.lastStressStateByDate = buildStressStateMap(
        effectiveUser,
        nextState.weekPlan,
        checkInsByDate,
        domain,
        params,
        packOverride
      );
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
        const lockSelection = shouldLockSelection(regenPolicy, dateISO);
        const keepSelection = lockSelection ? keepSelectionForDate(state, dateISO) : null;
        const keepFocus = lockSelection ? findDay(state.weekPlan, dateISO)?.focus : null;
        const checkInsByDate = buildCheckInsByDate(checkIns);
        const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
        const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);
        const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

        const overridesBase = withBaseOverrides({
          ...(intensityCap != null ? { intensityCap } : {}),
          ...(keepSelection ? { keepSelection, keepFocus } : {}),
        });
        const reEntryOverridesFor = (targetDateISO) =>
          reEntryOverridesForDate(nextState.reEntry, targetDateISO, todayISO, domain, engineGuards);
        const adapted = domain.adaptPlan({
          weekPlan: nextState.weekPlan,
          user: effectiveUser,
          todayISO: dateISO,
          signal: "im_stressed",
          checkInsByDate,
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          overridesBase,
          overridesForDate: reEntryOverridesFor,
          qualityRules: qualityRulesForDay,
          weekContextBase: { busyDays: effectiveUser.busyDays || [] },
          params,
          ruleConfig,
          library: domain.defaultLibrary,
          regenPolicy,
        });

        nextState.weekPlan = adapted.weekPlan;
        if (nextState.weekPlan && nextState.reEntry?.active) {
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
            todayISO,
            packOverride,
            ruleConfig,
            baseOverrides,
            reEntry: nextState.reEntry,
            engineGuards,
          });
          nextState.weekPlan = normalized.weekPlan;
          if (normalized.changed) {
            nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
          }
        }
        nextState.lastStressStateByDate = buildStressStateMap(
          effectiveUser,
          nextState.weekPlan,
          checkInsByDate,
          domain,
          params,
          packOverride
        );
        nextState.modifiers = modifiers;

        if (selectionChangedForDate(state, nextState, dateISO)) {
          recordRegen(nextState, dateISO, event.atISO);
        }

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
      if (ctx?.incidentMode) {
        effects.persist = true;
        logEvent = { type: "bad_day_mode", payload: { dateISO, incidentMode: true }, atISO: event.atISO };
        result = { changedDayISO: null, notes: ["Incident mode: plan frozen"] };
        return { nextState, effects, logEvent, result };
      }

      if (!ruleToggles.badDayEnabled) {
        effects.persist = true;
        logEvent = { type: "bad_day_mode", payload: { dateISO, disabled: true }, atISO: event.atISO };
        return { nextState, effects, logEvent, result };
      }

      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);
      const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);
      const lockSelection = shouldLockSelection(regenPolicy, dateISO);
      const keepSelection = lockSelection ? keepSelectionForDate(state, dateISO) : null;
      const keepFocus = lockSelection ? findDay(state.weekPlan, dateISO)?.focus : null;

      const beforeDay = findDay(nextState.weekPlan, dateISO);
      const res = rebuildDayInPlan({
        domain,
        user: effectiveUser,
        weekPlan: nextState.weekPlan,
        dateISO,
        todayISO,
        checkInsByDate,
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        overrides: withBaseOverrides({
          forceBadDayMode: true,
          intensityCap: intensityCap != null ? intensityCap : 2,
          ...(keepSelection ? { keepSelection, keepFocus } : {}),
        }),
        qualityRules: qualityRulesForDay,
        params,
        priorDayPlan: beforeDay,
        packOverride,
        ruleConfig,
        baseOverrides,
        reEntry: nextState.reEntry,
        engineGuards,
      });
      nextState.weekPlan = res.weekPlan;
      nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);

      if (nextState.weekPlan && nextState.reEntry?.active) {
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
          todayISO,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
        }
      }
      nextState.lastStressStateByDate = buildStressStateMap(
        effectiveUser,
        nextState.weekPlan,
        checkInsByDate,
        domain,
        params,
        packOverride
      );

      if (selectionChangedForDate(state, nextState, dateISO)) {
        recordRegen(nextState, dateISO, event.atISO);
      }

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

    case "FORCE_REFRESH": {
      const user = ensureUser();
      const dateISO = event.payload?.dateISO;
      if (!user || !dateISO) return { nextState, effects, logEvent, result };
      if (ctx?.incidentMode) {
        effects.persist = true;
        logEvent = { type: "force_refresh", payload: { dateISO, incidentMode: true }, atISO: event.atISO };
        result = { changedDayISO: null, notes: ["Incident mode: plan frozen"] };
        return { nextState, effects, logEvent, result };
      }

      const checkInsByDate = buildCheckInsByDate(checkIns);
      const modifiers = cleanupModifiers(nextState.modifiers || {}, dateISO);
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);
      const { intensityCap, qualityRules: qualityRulesForDay } = modifiersForDate(modifiers, dateISO, ruleToggles);

      const weekAnchorISO = domain.weekStartMonday(dateISO);
      let weekPlan = nextState.weekPlan;
      if (!weekPlan || weekPlan.startDateISO !== weekAnchorISO || !weekPlan.days.some((d) => d.dateISO === dateISO)) {
        weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: dateISO,
          checkInsByDate,
          qualityRules: qualityRulesForDay,
          params,
          ruleConfig,
          overridesBase: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
        });
        nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, weekPlan);
      }

      const beforeDay = findDay(weekPlan, dateISO);
      const res = rebuildDayInPlan({
        domain,
        user: effectiveUser,
        weekPlan,
        dateISO,
        todayISO,
        checkInsByDate,
        completionsByDate: nextState.partCompletionByDate || {},
        feedback: nextState.feedback || [],
        overrides: withBaseOverrides(intensityCap != null ? { intensityCap } : null),
        qualityRules: qualityRulesForDay,
        params,
        priorDayPlan: beforeDay,
        packOverride,
        ruleConfig,
        baseOverrides,
        reEntry: nextState.reEntry,
        engineGuards,
      });
      nextState.weekPlan = res.weekPlan;
      nextState.selectionStats = incrementPickedForDay(nextState.selectionStats, res.dayPlan);

      if (nextState.weekPlan && nextState.reEntry?.active) {
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
          todayISO,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
        }
      }
      nextState.lastStressStateByDate = buildStressStateMap(
        effectiveUser,
        nextState.weekPlan,
        checkInsByDate,
        domain,
        params,
        packOverride
      );
      nextState.modifiers = modifiers;

      if (selectionChangedForDate(state, nextState, dateISO)) {
        recordRegen(nextState, dateISO, event.atISO);
      }

      if (nextState.history) {
        nextState.history = addHistoryEntry(nextState.history, {
          reason: "Force refresh",
          dateISO,
          beforeDay,
          afterDay: findDay(nextState.weekPlan, dateISO),
        });
      }

      effects.persist = true;
      logEvent = { type: "force_refresh", payload: { dateISO }, atISO: event.atISO };
      result = { changedDayISO: dateISO, notes: ["Force refresh applied"] };
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
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);

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
          todayISO,
          checkInsByDate,
          completionsByDate: nextState.partCompletionByDate || {},
          feedback: nextState.feedback || [],
          overrides: withBaseOverrides(
            intensityCap != null ? { intensityCap, source: "feedback" } : { source: "feedback" }
          ),
          qualityRules: qualityRulesForDay,
          params,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
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
      if (nextState.weekPlan && nextState.reEntry?.active) {
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
          todayISO,
          packOverride,
          ruleConfig,
          baseOverrides,
          reEntry: nextState.reEntry,
          engineGuards,
        });
        nextState.weekPlan = normalized.weekPlan;
        if (normalized.changed) {
          nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
        }
      }
      nextState.lastStressStateByDate = buildStressStateMap(
        effectiveUser,
        nextPlan,
        checkInsByDate,
        domain,
        params,
        packOverride
      );
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
        if (nextState.userProfile) {
          nextState.userProfile = { ...nextState.userProfile, lastCompletionDateISO: dateISO };
        }
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
          params,
          packOverride
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
      const allowRuleToggles = ruleConfig.envMode === "dev" || ruleConfig.envMode === "dogfood";
      if (!allowRuleToggles) {
        return { nextState, effects, logEvent, result };
      }
      const incoming = event.payload?.ruleToggles || {};
      const base = initialStatePatch().ruleToggles;
      const nextToggles = { ...base, ...(nextState.ruleToggles || {}), ...incoming };
      nextState.ruleToggles = nextToggles;

      const user = ensureUser();
      if (user) {
        const checkInsByDate = buildCheckInsByDate(checkIns);
        const weekAnchorISO = nextState.weekPlan?.startDateISO || domain.weekStartMonday(todayISO);
        const effectiveUser = effectiveUserForDate(user, nextState.modifiers || {}, weekAnchorISO, packOverride);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO,
          checkInsByDate,
          qualityRules: buildQualityRules(nextToggles),
          params,
          ruleConfig,
          overridesBase: withBaseOverrides(null),
        });
        nextState.lastStressStateByDate = buildStressStateMap(
          effectiveUser,
          nextState.weekPlan,
          checkInsByDate,
          domain,
          params,
          packOverride
        );
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
        const effectiveUser = effectiveUserForDate(user, nextState.modifiers || {}, todayISO, packOverride);
        nextState.weekPlan = domain.generateWeekPlan({
          user: effectiveUser,
          weekAnchorISO: todayISO,
          checkInsByDate,
          qualityRules,
          params,
          ruleConfig,
          overridesBase: withBaseOverrides(null),
        });
        nextState.selectionStats = incrementPickedForWeek(nextState.selectionStats, nextState.weekPlan);
      }

      if (user && nextState.weekPlan) {
        nextState.lastStressStateByDate = buildStressStateMap(
          user,
          nextState.weekPlan,
          checkInsByDate,
          domain,
          params,
          packOverride
        );
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

function mergeOverrides(base, extra) {
  if (!base && !extra) return null;
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, ...extra };
}

function reEntryWindowEnd(reEntry, domain) {
  if (!reEntry?.startDateISO) return null;
  return domain.addDaysISO(reEntry.startDateISO, 2);
}

function isReEntryActiveForDate(reEntry, dateISO, todayISO, domain, engineGuards) {
  if (engineGuards?.reentryEnabled === false) return false;
  if (!reEntry || !reEntry.active) return false;
  if (!reEntry.startDateISO) return false;
  const endISO = reEntryWindowEnd(reEntry, domain);
  if (!endISO) return false;
  if (todayISO && todayISO > endISO) return false;
  if (dateISO < reEntry.startDateISO || dateISO > endISO) return false;
  return true;
}

function reEntryOverridesForDate(reEntry, dateISO, todayISO, domain, engineGuards) {
  if (!isReEntryActiveForDate(reEntry, dateISO, todayISO, domain, engineGuards)) return null;
  const dayIndex = Math.max(1, Math.min(3, Number(reEntry?.dayIndex) || 1));
  return {
    forceBadDayMode: true,
    source: "feedback",
    reEntry: { active: true, dayIndex, startDateISO: reEntry.startDateISO },
  };
}

function applyReEntryMeta(dayPlan, reEntryOverride, reEntry) {
  if (!dayPlan || !reEntryOverride) return dayPlan;
  const meta = dayPlan.meta ? { ...dayPlan.meta } : {};
  const dayIndex = Math.max(1, Math.min(3, Number(reEntry?.dayIndex) || 1));
  const reEntryMeta = reEntryOverride.reEntry || {
    active: true,
    dayIndex,
    startDateISO: reEntry?.startDateISO || null,
  };
  return { ...dayPlan, meta: { ...meta, reEntry: reEntryMeta } };
}

function expireReEntry(reEntry, todayISO, domain, reEntryEnabled, atISO) {
  if (!reEntry || typeof reEntry !== "object") return { value: reEntry || null, changed: false };
  const normalized = {
    ...reEntry,
    dayIndex: Math.max(1, Math.min(3, Number(reEntry.dayIndex) || 1)),
    active: reEntry.active !== false,
  };
  let changed = false;
  const endISO = reEntryWindowEnd(normalized, domain);
  if (normalized.active && reEntryEnabled === false) {
    normalized.active = false;
    changed = true;
  }
  if (normalized.active && endISO && todayISO && todayISO > endISO) {
    normalized.active = false;
    changed = true;
  }
  if (!normalized.active && !normalized.completedAtISO && atISO) {
    normalized.completedAtISO = atISO;
  }
  return { value: normalized, changed };
}

function advanceReEntry(reEntry, dateISO) {
  if (!reEntry || !reEntry.active || !reEntry.startDateISO) return { value: reEntry, changed: false };
  if (reEntry.lastAdvancedDateISO === dateISO) return { value: reEntry, changed: false };
  const dayIndex = Math.max(1, Math.min(3, Number(reEntry.dayIndex) || 1));
  const nextIndex = Math.max(1, Math.min(3, dayIndex + 1));
  return {
    value: {
      ...reEntry,
      dayIndex: nextIndex,
      lastAdvancedDateISO: dateISO,
    },
    changed: nextIndex !== dayIndex || reEntry.lastAdvancedDateISO !== dateISO,
  };
}

function reEntryDates(reEntry, todayISO, domain, engineGuards) {
  if (!reEntry || !reEntry.active) return [];
  if (engineGuards?.reentryEnabled === false) return [];
  const endISO = reEntryWindowEnd(reEntry, domain);
  if (!endISO || (todayISO && todayISO > endISO)) return [];
  const start = reEntry.startDateISO;
  if (!start) return [];
  return [start, domain.addDaysISO(start, 1), endISO];
}

function effectiveUserForDate(user, modifiers, dateISO, packOverride = null) {
  if (!user) return user;
  const mod = modifiers || {};
  const biasActive = mod.preferredWindowBias && isActiveUntil(dateISO, mod.preferredWindowBiasUntilISO);
  const baseUser = biasActive
    ? (() => {
        const windows = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
        const nextWindows = [mod.preferredWindowBias, ...windows.filter((w) => w !== mod.preferredWindowBias)];
        return { ...user, preferredWorkoutWindows: nextWindows };
      })()
    : user;
  if (!packOverride) return baseUser;
  return { ...baseUser, contentPack: packOverride };
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
  todayISO,
  packOverride,
  ruleConfig,
  baseOverrides,
  reEntry,
  engineGuards,
}) {
  const nextDays = [];
  let changed = false;
  const base = baseOverrides ? { ...baseOverrides } : null;
  const withBaseOverrides = (overrides) => {
    if (!base) return overrides;
    if (!overrides) return { ...base };
    return { ...overrides, ...base };
  };

  for (let i = 0; i < weekPlan.days.length; i += 1) {
    const day = weekPlan.days[i];
    if (todayISO && day.dateISO < todayISO) {
      nextDays.push(day);
      continue;
    }
    const dateISO = day.dateISO;
    const reEntryOverride = reEntryOverridesForDate(reEntry, dateISO, todayISO, domain, engineGuards);
    const reEntryApplied =
      reEntryOverride &&
      day?.meta?.reEntry &&
      day.meta.reEntry.startDateISO === reEntry?.startDateISO;
    const needsReEntryRebuild = Boolean(reEntryOverride && !reEntryApplied);
    if (day.pipelineVersion !== DECISION_PIPELINE_VERSION || needsReEntryRebuild) {
      const effectiveUser = effectiveUserForDate(user, modifiers, dateISO, packOverride);
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
        overrides: mergeOverrides(withBaseOverrides(intensityCap != null ? { intensityCap } : null), reEntryOverride),
        qualityRules: rulesForDay,
        params,
        ruleConfig,
      });
      nextDays.push(applyReEntryMeta(dayPlan, reEntryOverride, reEntry));
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
  todayISO,
  checkInsByDate,
  completionsByDate,
  feedback,
  overrides,
  qualityRules,
  params,
  priorDayPlan,
  packOverride,
  ruleConfig,
  baseOverrides,
  reEntry,
  engineGuards,
}) {
  const idx = weekPlan.days.findIndex((d) => d.dateISO === dateISO);
  if (idx === -1) return { weekPlan, dayPlan: null };

  const recentNoveltyGroups = collectRecentNoveltyGroups(weekPlan.days, idx, 2);
  const base = baseOverrides ? { ...baseOverrides } : null;
  const withBaseOverrides = (nextOverrides) => {
    if (!base) return nextOverrides;
    if (!nextOverrides) return { ...base };
    return { ...nextOverrides, ...base };
  };
  const userForDay = packOverride ? { ...user, contentPack: packOverride } : user;
  const reEntryOverride = reEntryOverridesForDate(reEntry, dateISO, todayISO || dateISO, domain, engineGuards);
  const { dayPlan } = domain.buildDayPlan({
    user: userForDay,
    dateISO,
    checkIn: checkInsByDate ? checkInsByDate[dateISO] : undefined,
    checkInsByDate,
    completionsByDate,
    feedback,
    weekContext: { busyDays: userForDay.busyDays || [], recentNoveltyGroups },
    overrides: mergeOverrides(withBaseOverrides(overrides), reEntryOverride),
    qualityRules,
    params,
    ruleConfig,
    priorDayPlan: priorDayPlan || weekPlan.days[idx],
  });

  const nextDays = weekPlan.days.slice();
  nextDays[idx] = applyReEntryMeta(dayPlan, reEntryOverride, reEntry);
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

function freezePastDays(prevWeekPlan, nextWeekPlan, todayISO) {
  if (!prevWeekPlan || !nextWeekPlan || !todayISO) return nextWeekPlan;
  const prevByDate = new Map((prevWeekPlan.days || []).map((day) => [day.dateISO, day]));
  const nextDays = (nextWeekPlan.days || []).map((day) => {
    if (day.dateISO >= todayISO) return day;
    return prevByDate.get(day.dateISO) || day;
  });
  return { ...nextWeekPlan, days: nextDays };
}

function shouldLockSelection(regenPolicy, dateISO) {
  if (!regenPolicy || !dateISO) return false;
  return regenPolicy.lockSelectionsByDate?.[dateISO] === true;
}

function keepSelectionForDate(state, dateISO) {
  const day = findDay(state.weekPlan, dateISO);
  const selected = day?.meta?.selected;
  if (selected) {
    return {
      workoutId: selected.workoutId || null,
      resetId: selected.resetId || null,
      nutritionId: selected.nutritionId || null,
      noveltyGroups: { ...(selected.noveltyGroups || {}) },
    };
  }
  if (!day) return null;
  return {
    workoutId: day.workout?.id || null,
    resetId: day.reset?.id || null,
    nutritionId: day.nutrition?.id || null,
    noveltyGroups: day.selectedNoveltyGroups || {
      workout: day.workout?.noveltyGroup,
      reset: day.reset?.noveltyGroup,
      nutrition: day.nutrition?.noveltyGroup,
    },
  };
}

function selectionSignature(dayPlan) {
  if (!dayPlan) return "";
  const selected = dayPlan.meta?.selected || {};
  const workoutId = selected.workoutId || dayPlan.workout?.id || "";
  const resetId = selected.resetId || dayPlan.reset?.id || "";
  const nutritionId = selected.nutritionId || dayPlan.nutrition?.id || "";
  return `${workoutId}|${resetId}|${nutritionId}`;
}

function selectionChangedForDate(prevState, nextState, dateISO) {
  if (!dateISO) return false;
  const prevDay = findDay(prevState.weekPlan, dateISO);
  const nextDay = findDay(nextState.weekPlan, dateISO);
  return selectionSignature(prevDay) !== selectionSignature(nextDay);
}

function recordRegen(nextState, dateISO, atISO) {
  if (!dateISO) return;
  const stamp = typeof atISO === "string" && atISO ? atISO : new Date().toISOString();
  const current = nextState.regenWindow?.lastRegenAtISOByDate || {};
  nextState.regenWindow = {
    lastRegenAtISOByDate: {
      ...current,
      [dateISO]: stamp,
    },
  };
}

function buildStressStateMap(user, plan, checkInsByDate, domain, params, packOverride = null) {
  const map = {};
  const effectiveUser = packOverride ? { ...user, contentPack: packOverride } : user;
  plan.days.forEach((day) => {
    const checkIn = checkInsByDate ? checkInsByDate[day.dateISO] : undefined;
    const stressState = domain.assignStressProfile({ user: effectiveUser, dateISO: day.dateISO, checkIn, params });
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
