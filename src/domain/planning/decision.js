import { assignStressProfile } from "../scoring/profile.js";
import { computeRecoveryDebt } from "../scoring/recoveryDebt.js";
import { defaultLibrary } from "../content/library.js";
import { getLibraryIndex, getCandidates } from "../content/indexer.js";
import { applyConstraints } from "./constraints.js";
import { DECISION_PIPELINE_VERSION } from "../constants.js";
import { appendAppliedRule, validateAppliedRules } from "./rules.js";
import { DEFAULT_PARAMETERS } from "../params.js";
import { evaluateSafety } from "./safety.js";
import { computeConfidence, computeRelevance } from "./quality.js";
import { validateDayPlan } from "./validatePlan.js";

export function buildDayPlan({
  user,
  dateISO,
  checkIn,
  checkInsByDate,
  completionsByDate,
  feedback,
  weekContext,
  overrides,
  qualityRules,
  params,
  ruleConfig,
  library,
}) {
  const ctx = weekContext || {};
  const rules = {
    avoidNoveltyWindowDays: 2,
    constraintsEnabled: true,
    noveltyEnabled: true,
    recoveryDebtEnabled: true,
    circadianAnchorsEnabled: true,
    safetyEnabled: true,
    ...(qualityRules || {}),
  };
  const ov = overrides || {};
  const paramMap = params || {};
  const ruleCfg = ruleConfig || {};
  const libraryRef = library || defaultLibrary;
  const focusBiasRules = paramMap.focusBiasRules || DEFAULT_PARAMETERS.focusBiasRules;
  const packResolved = resolveContentPackWeights(user?.contentPack, paramMap);
  const packWeights = packResolved.weights;
  const packId = packResolved.packId;

  const recoveryDebt = rules.recoveryDebtEnabled ? computeRecoveryDebt(checkInsByDate, dateISO, paramMap) : 0;
  const stressState = assignStressProfile({
    user,
    dateISO,
    checkIn,
    params: paramMap,
    profileOverride: ov.profileOverride,
  });
  stressState.recoveryDebt = recoveryDebt;
  const appliedRules = [];
  if (ov.profileOverride) appendAppliedRule(appliedRules, "profile_override", ruleCfg);
  if (ov.experimentMeta?.packId) appendAppliedRule(appliedRules, "experiment_pack_override", ruleCfg);
  if (ov.experimentMeta?.paramsOverride) appendAppliedRule(appliedRules, "experiment_params_override", ruleCfg);
  if (ov.railReset) appendAppliedRule(appliedRules, "rail_reset", ruleCfg);
  const markOverride = () => {
    if (ov.source === "feedback") {
      appendAppliedRule(appliedRules, "feedback_modifier", ruleCfg);
    } else {
      appendAppliedRule(appliedRules, "signal_override", ruleCfg);
    }
  };

  let focus = focusFromProfile(stressState.profile, stressState.capacity, focusBiasRules);

  if (ov.focusBias) {
    if (ov.focusBias === "rebuild" && stressState.loadBand === "high") {
      focus = "stabilize";
    } else {
      focus = ov.focusBias;
    }
    markOverride();
  }

  if (ov.keepFocus) {
    focus = ov.keepFocus;
    appendAppliedRule(appliedRules, "keep_focus", ruleCfg);
  }

  if (ov.forceBadDayMode) {
    focus = "downshift";
    appendAppliedRule(appliedRules, "bad_day_mode", ruleCfg);
  }

  if (!ov.forceBadDayMode && rules.recoveryDebtEnabled && recoveryDebt >= focusBiasRules.recoveryDebtBiasLow) {
    const priorFocus = focus;
    if (recoveryDebt >= focusBiasRules.recoveryDebtBiasHigh) {
      focus = "downshift";
    } else if (focus === "rebuild") {
      focus = "stabilize";
    }
    if (focus !== priorFocus) {
      appendAppliedRule(appliedRules, "recovery_debt_bias", ruleCfg);
    }
  }

  let timeMin = checkIn ? checkIn.timeAvailableMin : 20;
  if (ov.timeOverrideMin != null) {
    timeMin = ov.timeOverrideMin;
    markOverride();
  }

  const busyDays = new Set([...(user.busyDays || []), ...((ctx.busyDays || []))]);
  const isBusy = busyDays.has(dateISO);
  if (isBusy) {
    timeMin = Math.min(timeMin, 15);
    appendAppliedRule(appliedRules, "busy_day", ruleCfg);
  }

  if (ov.forceBadDayMode) timeMin = Math.min(timeMin, 10);

  const baseCap = focus === "downshift" ? 4 : 10;
  let intensityCap = baseCap;
  if (ov.intensityCap != null) {
    intensityCap = Math.min(intensityCap, ov.intensityCap);
    markOverride();
  }
  if (ov.forceBadDayMode) intensityCap = Math.min(intensityCap, 2);

  const avoidGroups =
    rules.noveltyEnabled && rules.avoidNoveltyWindowDays > 0 ? ctx.recentNoveltyGroups || [] : [];
  if (avoidGroups.length) appendAppliedRule(appliedRules, "novelty_avoidance", ruleCfg);

  const resetFocus = ov.resetFocus || focus;
  if (resetFocus !== focus) appendAppliedRule(appliedRules, "reset_focus_override", ruleCfg);
  const rankedWorkouts = rankWorkouts({
    focus,
    timeMin,
    checkIn,
    intensityCap,
    avoidGroups,
    packWeights,
    keepSelection: ov.keepSelection,
    library: libraryRef,
  });
  const rankedNutrition = rankNutrition({
    focus,
    avoidGroups,
    forceBadDayMode: ov.forceBadDayMode,
    packWeights,
    keepSelection: ov.keepSelection,
    library: libraryRef,
  });
  const rankedResets = rankResets({
    focus: resetFocus,
    timeMin,
    avoidGroups,
    forceBadDayMode: ov.forceBadDayMode,
    packWeights,
    keepSelection: ov.keepSelection,
    library: libraryRef,
  });

  let workout =
    rankedWorkouts[0] ||
    pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, library: libraryRef });
  let nutrition =
    rankedNutrition[0] ||
    pickNutrition({ focus, avoidGroups, forceBadDayMode: ov.forceBadDayMode, packWeights, library: libraryRef });
  let reset =
    rankedResets[0] ||
    pickReset({
      focus: resetFocus,
      timeMin,
      avoidGroups,
      forceBadDayMode: ov.forceBadDayMode,
      packWeights,
      library: libraryRef,
    });
  const workoutWindow = pickWorkoutWindow(user);

  const rationale = [
    `Profile: ${stressState.profile}`,
    `Focus: ${focus}`,
    ...stressState.drivers.slice(0, 2),
  ];

  if (isBusy) rationale.push("Busy day -> shorter plan");
  if (ov.forceBadDayMode) rationale.push("Adjusted: bad day mode");
  if (ov.focusBias && !ov.forceBadDayMode) rationale.push("Adjusted: focus bias");
  if (ov.timeOverrideMin != null && !ov.forceBadDayMode) rationale.push("Adjusted: time override");
  if (ov.intensityCap != null && !ov.forceBadDayMode) rationale.push("Adjusted: intensity cap");
  if (rules.recoveryDebtEnabled && recoveryDebt >= 20) rationale.push("Recovery debt elevated");

  let dayDraft = {
    dateISO,
    profile: stressState.profile,
    focus,
    workout,
    nutrition,
    reset,
    rationale,
    workoutWindow,
    anchors: rules.circadianAnchorsEnabled ? buildAnchors(user) : null,
    selectedNoveltyGroups: {
      workout: workout?.noveltyGroup || null,
      nutrition: nutrition?.noveltyGroup || null,
      reset: reset?.noveltyGroup || null,
    },
  };

  if (rules.constraintsEnabled) {
    dayDraft = applyConstraints({ user, checkIn, state: stressState, dayDraft });
  }

  let safety = { level: "ok", reasons: [] };
  if (rules.safetyEnabled) {
    safety = evaluateSafety({ checkIn, stressState, userProfile: user });
    if (safety.level !== "ok") {
      dayDraft = applySafetyOverrides(dayDraft, safety, {
        timeMin,
        focus,
        packWeights,
        library: libraryRef,
      });
      appendAppliedRule(appliedRules, safety.level === "block" ? "safety_block" : "emergency_downshift", ruleCfg);
    }
  }

  if (rules.constraintsEnabled) {
    if (checkIn && checkIn.timeAvailableMin <= 10) appendAppliedRule(appliedRules, "time_min_constraint", ruleCfg);
    if (stressState.profile === "PoorSleep") appendAppliedRule(appliedRules, "poor_sleep_constraint", ruleCfg);
    if (stressState.profile === "WiredOverstimulated") appendAppliedRule(appliedRules, "wired_constraint", ruleCfg);
    if (stressState.profile === "DepletedBurnedOut") appendAppliedRule(appliedRules, "depleted_constraint", ruleCfg);
  }

  let finalIntensityCap = intensityCap;
  if (dayDraft.focus === "downshift") finalIntensityCap = Math.min(finalIntensityCap, 4);

  if (ov.forceBadDayMode) {
    dayDraft.focus = "downshift";
    if (dayDraft.workout) {
      dayDraft.workout = enforceWorkoutCap(dayDraft.workout, {
        focus: "downshift",
        timeMin,
        checkIn,
        intensityCap: finalIntensityCap,
        avoidGroups,
        packWeights,
        library: libraryRef,
      });
    }
    dayDraft.reset = enforceBadDayReset(dayDraft.reset, packWeights, libraryRef);
    dayDraft.nutrition = enforceBadDayNutrition(dayDraft.nutrition, packWeights, libraryRef);
  } else if (dayDraft.workout && dayDraft.workout.intensityCost > finalIntensityCap) {
    dayDraft.workout = pickWorkout({
      focus: dayDraft.focus,
      timeMin,
      checkIn,
      intensityCap: finalIntensityCap,
      avoidGroups,
      packWeights,
      library: libraryRef,
    });
  }

  const gateResult = applyQualityGate({
    dayDraft,
    checkIn,
    timeMin,
    rankedWorkouts,
    safety,
    packWeights,
    library: libraryRef,
  });
  dayDraft = gateResult.dayDraft;
  if (gateResult.qualityGate?.triggered) {
    appendAppliedRule(
      appliedRules,
      gateResult.qualityGate.fallbackUsed ? "quality_gate_fallback" : "quality_gate",
      ruleCfg
    );
  }

  dayDraft.selectedNoveltyGroups = {
    workout: dayDraft.workout?.noveltyGroup || null,
    nutrition: dayDraft.nutrition?.noveltyGroup || null,
    reset: dayDraft.reset?.noveltyGroup || null,
  };

  const finalRationale = dayDraft.rationale ? dayDraft.rationale.slice() : [];
  finalRationale[0] = `Profile: ${stressState.profile}`;
  finalRationale[1] = `Focus: ${dayDraft.focus}`;
  dayDraft.rationale = finalRationale;

  const normalizedRules = validateAppliedRules(appliedRules, ruleCfg);
  const meta = {
    pipelineVersion: DECISION_PIPELINE_VERSION,
    generatedAtISO: new Date().toISOString(),
    appliedRules: normalizedRules,
    selected: {
      workoutId: dayDraft.workout?.id || null,
      resetId: dayDraft.reset?.id || null,
      nutritionId: dayDraft.nutrition?.id || null,
      noveltyGroups: { ...dayDraft.selectedNoveltyGroups },
    },
    qualityGate: gateResult.qualityGate,
    safetyLevel: safety.level,
  };

  dayDraft.pipelineVersion = meta.pipelineVersion;
  dayDraft.meta = meta;
  dayDraft.safety = safety;

  const confidence = computeConfidence({ checkIn, stressState });
  const relevance = computeRelevance({
    dayPlan: dayDraft,
    recentFeedback: feedback,
    completionsByDate,
    packWeights,
  });
  dayDraft.meta.confidence = confidence;
  dayDraft.meta.relevance = relevance;
  dayDraft.meta.packMatch = computePackMatch(dayDraft, packId, packWeights);

  return { dayPlan: dayDraft, stressState, meta };
}

function focusFromProfile(profile, capacity, focusBiasRules = DEFAULT_PARAMETERS.focusBiasRules) {
  if (profile === "WiredOverstimulated" || profile === "PoorSleep") return "downshift";
  if (profile === "DepletedBurnedOut" || profile === "RestlessAnxious") return "stabilize";
  if (profile === "Balanced") return capacity >= focusBiasRules.rebuildCapacityMin ? "rebuild" : "stabilize";
  return "stabilize";
}

function rankWorkouts({ focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, keepSelection, library }) {
  const libraryRef = library || defaultLibrary;
  const index = getLibraryIndex(libraryRef);
  const lib = index.byKind.workout;
  const baseFilter = (w) => {
    if (w.enabled === false) return false;
    if (timeMin != null && w.minutes > timeMin) return false;
    if (checkIn && w.minSleepQuality != null && checkIn.sleepQuality < w.minSleepQuality) return false;
    if (w.intensityCost > intensityCap) return false;
    return true;
  };

  let candidates = getCandidates(index, "workout", focus).filter(baseFilter);
  if (!candidates.length) candidates = lib.filter(baseFilter);
  candidates = applyNoveltyFilter(candidates, avoidGroups);
  if (!candidates.length) candidates = lib.filter((item) => item.enabled !== false);
  const sorted = candidates.sort((a, b) => workoutSort(a, b, { focus, timeMin, packWeights }));
  const keepId = keepSelection?.workoutId;
  if (!keepId) return sorted;
  const keepItem = lib.find((item) => item.id === keepId);
  if (!keepItem || !baseFilter(keepItem)) return sorted;
  return injectKeepSelection(sorted, keepItem);
}

function rankNutrition({ focus, avoidGroups, forceBadDayMode, packWeights, keepSelection, library }) {
  const libraryRef = library || defaultLibrary;
  const index = getLibraryIndex(libraryRef);
  const lib = index.byKind.nutrition;
  let candidates;

  if (forceBadDayMode) {
    candidates = lib.filter((n) => n.enabled !== false && (n.tags.includes("sleep") || n.tags.includes("downshift")));
  } else {
    candidates = getCandidates(index, "nutrition", focus).filter((item) => item.enabled !== false);
  }

  if (!candidates.length) candidates = lib.filter((item) => item.enabled !== false);
  candidates = applyNoveltyFilter(candidates, avoidGroups);
  if (!candidates.length) candidates = lib.filter((item) => item.enabled !== false);
  const sorted = candidates.sort((a, b) => commonSort(a, b, packWeights?.nutritionTagWeights));
  const keepId = keepSelection?.nutritionId;
  if (!keepId) return sorted;
  const keepItem = lib.find((item) => item.id === keepId && item.enabled !== false);
  if (!keepItem) return sorted;
  return injectKeepSelection(sorted, keepItem);
}

function rankResets({ focus, timeMin, avoidGroups, forceBadDayMode, packWeights, keepSelection, library }) {
  const libraryRef = library || defaultLibrary;
  const index = getLibraryIndex(libraryRef);
  const lib = index.byKind.reset;
  const tag = focus === "rebuild" ? "stabilize" : focus;
  const maxMinutes = forceBadDayMode ? 3 : Math.min(5, Math.max(2, Math.floor((timeMin || 20) / 10)));
  const baseFilter = (r) => r.enabled !== false && r.minutes <= maxMinutes;

  let candidates = lib.filter((r) => r.tags.includes(tag)).filter(baseFilter);
  if (!candidates.length) candidates = lib.filter(baseFilter);
  candidates = applyNoveltyFilter(candidates, avoidGroups);
  if (!candidates.length) candidates = lib.filter(baseFilter);
  const sorted = candidates.sort((a, b) => commonSort(a, b, packWeights?.resetTagWeights));
  const keepId = keepSelection?.resetId;
  if (!keepId) return sorted;
  const keepItem = lib.find((item) => item.id === keepId);
  if (!keepItem || !baseFilter(keepItem)) return sorted;
  return injectKeepSelection(sorted, keepItem);
}

function pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, library }) {
  const libraryRef = library || defaultLibrary;
  const ranked = rankWorkouts({ focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, library: libraryRef });
  return ranked[0] || libraryRef.workouts?.[0] || (library ? null : defaultLibrary.workouts[0]);
}

function pickNutrition({ focus, avoidGroups, forceBadDayMode, packWeights, library }) {
  const libraryRef = library || defaultLibrary;
  const ranked = rankNutrition({ focus, avoidGroups, forceBadDayMode, packWeights, library: libraryRef });
  return ranked[0] || libraryRef.nutrition?.[0] || (library ? null : defaultLibrary.nutrition[0]);
}

function pickReset({ focus, timeMin, avoidGroups, forceBadDayMode, packWeights, library }) {
  const libraryRef = library || defaultLibrary;
  const ranked = rankResets({ focus, timeMin, avoidGroups, forceBadDayMode, packWeights, library: libraryRef });
  return ranked[0] || libraryRef.resets?.[0] || (library ? null : defaultLibrary.resets[0]);
}

function pickWorkoutWindow(user) {
  const prefs = Array.isArray(user.preferredWorkoutWindows) ? user.preferredWorkoutWindows : [];
  if (prefs.includes("PM")) return "PM";
  if (prefs.length) return prefs[0];
  return "PM";
}

function applyNoveltyFilter(items, avoidGroups) {
  if (!avoidGroups || !avoidGroups.length) return items;
  const filtered = items.filter((item) => !avoidGroups.includes(item.noveltyGroup));
  return filtered.length ? filtered : items;
}

function injectKeepSelection(items, keepItem) {
  if (!keepItem) return items;
  const rest = items.filter((item) => item.id !== keepItem.id);
  return [keepItem, ...rest];
}

function isSafetyBlock(checkIn, safety) {
  if (safety?.level === "block") return true;
  return Boolean(checkIn?.panic || checkIn?.illness || checkIn?.fever);
}

function pickShortestReset(maxMinutes, packWeights, library) {
  const libraryRef = library || defaultLibrary;
  const cap = maxMinutes != null ? Math.max(1, maxMinutes) : 5;
  const eligible = (libraryRef.resets || defaultLibrary.resets)
    .filter((item) => item.enabled !== false && item.minutes <= cap)
    .sort((a, b) => commonSort(a, b, packWeights?.resetTagWeights));
  if (eligible.length) return eligible[0];
  return (libraryRef.resets || defaultLibrary.resets)
    .filter((item) => item.enabled !== false)
    .sort((a, b) => (a.minutes || 0) - (b.minutes || 0))[0];
}

function applyQualityGate({ dayDraft, checkIn, timeMin, rankedWorkouts, safety, packWeights, library }) {
  const reasons = new Set();
  const timeAvailableMin = Number(checkIn?.timeAvailableMin ?? timeMin ?? 0) || null;
  const safetyBlock = isSafetyBlock(checkIn, safety);
  let current = dayDraft;
  let triggered = false;
  let fallbackUsed = false;
  let attempts = 0;

  if (safetyBlock && current.workout !== null) {
    triggered = true;
    reasons.add("safety_block");
    current = { ...current, workout: null };
  }

  let validation = validateDayPlan(current, { checkIn, timeAvailableMin });
  if (validation.ok) {
    return { dayDraft: current, qualityGate: triggered ? { triggered: true, reasons: Array.from(reasons), fallbackUsed, attempts } : null };
  }

  while (!validation.ok && attempts < 5) {
    triggered = true;
    validation.reasons.forEach((reason) => reasons.add(reason.key));
    const candidate = rankedWorkouts[attempts + 1];
    attempts += 1;
    if (!candidate || safetyBlock) break;
    current = { ...current, workout: candidate };
    fallbackUsed = true;
    validation = validateDayPlan(current, { checkIn, timeAvailableMin });
  }

  if (!validation.ok) {
    const emergencyCap = timeAvailableMin ?? timeMin ?? 10;
    let workout = safetyBlock ? null : pickEmergencyWorkout(emergencyCap, packWeights, library) || current.workout;
    let reset = pickShortestReset(emergencyCap, packWeights, library);
    if (emergencyCap != null) {
      const remaining = Math.max(0, emergencyCap - (reset?.minutes || 0));
      if (workout && workout.minutes > remaining) {
        workout = rankedWorkouts.find((item) => item.minutes <= remaining) || (safetyBlock ? null : workout);
      }
      if ((reset?.minutes || 0) > emergencyCap) {
        reset = pickShortestReset(emergencyCap, packWeights, library);
      }
    }
    current = {
      ...current,
      focus: safetyBlock ? current.focus : "downshift",
      workout,
      reset,
      nutrition: pickEmergencyNutrition(packWeights, library),
      rationale: [...(current.rationale || []), "Quality gate: emergency downshift applied"],
    };
    fallbackUsed = true;
    validation = validateDayPlan(current, { checkIn, timeAvailableMin });
    validation.reasons.forEach((reason) => reasons.add(reason.key));
  }

  const qualityGate = triggered
    ? { triggered: true, reasons: Array.from(reasons), fallbackUsed, attempts }
    : null;
  return { dayDraft: current, qualityGate };
}

function workoutSort(a, b, { focus, timeMin, packWeights }) {
  const packScoreA = scorePack(a, packWeights?.workoutTagWeights);
  const packScoreB = scorePack(b, packWeights?.workoutTagWeights);
  if (packScoreA !== packScoreB) return packScoreB - packScoreA;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (focus === "downshift") {
    if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
    if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    return a.id.localeCompare(b.id);
  }
  const da = timeMin != null ? timeMin - a.minutes : a.minutes;
  const db = timeMin != null ? timeMin - b.minutes : b.minutes;
  if (da !== db) return da - db;
  if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
  return a.id.localeCompare(b.id);
}

function commonSort(a, b, tagWeights) {
  const packScoreA = scorePack(a, tagWeights);
  const packScoreB = scorePack(b, tagWeights);
  if (packScoreA !== packScoreB) return packScoreB - packScoreA;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.intensityCost !== b.intensityCost) return a.intensityCost - b.intensityCost;
  if (a.minutes !== b.minutes) return a.minutes - b.minutes;
  return a.id.localeCompare(b.id);
}

function enforceBadDayReset(current, packWeights, library) {
  const libraryRef = library || defaultLibrary;
  if (!current) return pickShortestReset(3, packWeights, libraryRef) || defaultLibrary.resets[0];
  if (current.minutes <= 3 && current.tags.includes("downshift")) return current;
  const candidates = (libraryRef.resets || defaultLibrary.resets)
    .filter((r) => r.minutes <= 3)
    .filter((r) => r.tags.includes("downshift"))
    .sort((a, b) => commonSort(a, b, packWeights?.resetTagWeights));
  return candidates[0] || current;
}

function enforceBadDayNutrition(current, packWeights, library) {
  const libraryRef = library || defaultLibrary;
  if (!current) return pickEmergencyNutrition(packWeights, libraryRef) || defaultLibrary.nutrition[0];
  let next = current;
  if (!(current.tags.includes("sleep") || current.tags.includes("downshift"))) {
    const candidates = (libraryRef.nutrition || defaultLibrary.nutrition)
      .filter((n) => n.tags.includes("sleep") || n.tags.includes("downshift"))
      .sort((a, b) => commonSort(a, b, packWeights?.nutritionTagWeights));
    next = candidates[0] || current;
  }
  if (Array.isArray(next.priorities)) {
    next = { ...next, priorities: next.priorities.slice(0, 2) };
  }
  return next;
}

function enforceWorkoutCap(current, { focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, library }) {
  if (current.intensityCost <= intensityCap && current.minutes <= timeMin) return current;
  return pickWorkout({ focus, timeMin, checkIn, intensityCap, avoidGroups, packWeights, library });
}

export { focusFromProfile };

function resolveContentPackWeights(packKey, params) {
  const packs = params?.contentPackWeights || DEFAULT_PARAMETERS.contentPackWeights;
  const fallbackId = "balanced_routine";
  const packId = packKey && packs?.[packKey] ? packKey : fallbackId;
  const weights = packs?.[packId] || DEFAULT_PARAMETERS.contentPackWeights[fallbackId];
  return { packId, weights };
}

function scorePack(item, tagWeights) {
  if (!tagWeights || !item?.tags) return 0;
  return item.tags.reduce((sum, tag) => sum + (tagWeights[tag] || 0), 0);
}

function pickEmergencyWorkout(timeMin, packWeights, library) {
  const libraryRef = library || defaultLibrary;
  const cap = timeMin != null ? Math.max(5, timeMin) : 15;
  const candidates = (libraryRef.workouts || defaultLibrary.workouts)
    .filter((w) => w.tags.includes("downshift") || w.tags.includes("gentle"))
    .filter((w) => w.minutes <= cap);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => workoutSort(a, b, { focus: "downshift", timeMin: cap, packWeights }))[0];
}

function pickEmergencyReset(packWeights, library) {
  const libraryRef = library || defaultLibrary;
  const candidates = (libraryRef.resets || defaultLibrary.resets).filter(
    (r) => r.tags.includes("downshift") || r.tags.includes("breathe")
  );
  if (!candidates.length) return (libraryRef.resets || defaultLibrary.resets)[0] || (library ? null : defaultLibrary.resets[0]);
  return candidates.sort((a, b) => commonSort(a, b, packWeights?.resetTagWeights))[0];
}

function pickPanicReset(library) {
  const libraryRef = library || defaultLibrary;
  const candidates = (libraryRef.resets || defaultLibrary.resets).filter((r) =>
    r.tags.includes("panic_mode")
  );
  if (!candidates.length) return null;
  return candidates[0];
}

function pickEmergencyNutrition(packWeights, library) {
  const libraryRef = library || defaultLibrary;
  const candidates = (libraryRef.nutrition || defaultLibrary.nutrition).filter(
    (n) => n.tags.includes("sleep") || n.tags.includes("downshift")
  );
  if (!candidates.length) return (libraryRef.nutrition || defaultLibrary.nutrition)[0] || (library ? null : defaultLibrary.nutrition[0]);
  return candidates.sort((a, b) => commonSort(a, b, packWeights?.nutritionTagWeights))[0];
}

function applySafetyOverrides(dayDraft, safety, { timeMin, focus, packWeights, library }) {
  if (safety.level === "block") {
    const shouldNullWorkout = safety.reasons.includes("panic") || safety.reasons.includes("illness") || safety.reasons.includes("fever");
    const workout = shouldNullWorkout ? null : pickEmergencyWorkout(timeMin || 10, packWeights, library);
    const reset = safety.reasons.includes("panic")
      ? pickPanicReset(library) || pickEmergencyReset(packWeights, library)
      : pickEmergencyReset(packWeights, library);
    const nutrition = pickEmergencyNutrition(packWeights, library);
    return {
      ...dayDraft,
      focus: focus === "rebuild" ? "downshift" : dayDraft.focus,
      workout,
      reset,
      nutrition,
      rationale: [...(dayDraft.rationale || []), "Safety check: emergency downshift applied"],
    };
  }
  if (safety.level === "caution") {
    if (dayDraft.workout && dayDraft.workout.intensityCost > 2) {
      const workout = pickEmergencyWorkout(timeMin || 10, packWeights, library) || dayDraft.workout;
      return {
        ...dayDraft,
        workout,
        rationale: [...(dayDraft.rationale || []), "Safety check: reduced intensity"],
      };
    }
  }
  return dayDraft;
}

function maxWeight(weights) {
  if (!weights || typeof weights !== "object") return 0;
  return Object.values(weights).reduce((max, value) => (value > max ? value : max), 0);
}

function addMatchedTags(tagScores, item, weights) {
  if (!item?.tags || !weights) return;
  item.tags.forEach((tag) => {
    const weight = Number(weights[tag] || 0);
    if (weight <= 0) return;
    tagScores.set(tag, (tagScores.get(tag) || 0) + weight);
  });
}

function computePackMatch(dayDraft, packId, packWeights) {
  const workoutWeights = packWeights?.workoutTagWeights || {};
  const resetWeights = packWeights?.resetTagWeights || {};
  const nutritionWeights = packWeights?.nutritionTagWeights || {};
  const totalScore =
    scorePack(dayDraft.workout, workoutWeights) +
    scorePack(dayDraft.reset, resetWeights) +
    scorePack(dayDraft.nutrition, nutritionWeights);
  const maxPossible = maxWeight(workoutWeights) + maxWeight(resetWeights) + maxWeight(nutritionWeights);
  const score = maxPossible > 0 ? Math.min(1, totalScore / maxPossible) : 0;
  const tagScores = new Map();
  addMatchedTags(tagScores, dayDraft.workout, workoutWeights);
  addMatchedTags(tagScores, dayDraft.reset, resetWeights);
  addMatchedTags(tagScores, dayDraft.nutrition, nutritionWeights);
  const topMatchedTags = Array.from(tagScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
  return { packId, score, topMatchedTags };
}
function buildAnchors(user) {
  const sunlightTarget = Number(user.sunlightMinutesPerDay || 0);
  const minutes = Math.max(5, Math.min(15, Math.round(sunlightTarget ? sunlightTarget / 4 : 10)));
  const sunlightAnchor = {
    minutes,
    timing: "AM",
    instruction: `Get ${minutes} minutes of daylight within 2 hours of waking.`,
  };

  const mealConsistency = Number(user.mealTimingConsistency || 5);
  const mealTimingAnchor = {
    instruction:
      mealConsistency <= 5
        ? "Protein-forward breakfast within 2 hours of waking."
        : "Keep meals at consistent times today.",
  };

  return { sunlightAnchor, mealTimingAnchor };
}
