function latestCheckInForDate(checkIns, dateISO) {
  if (!Array.isArray(checkIns)) return null;
  let latest = null;
  checkIns.forEach((entry) => {
    if (entry?.dateISO !== dateISO) return;
    if (!latest) {
      latest = entry;
      return;
    }
    const prevAt = latest.atISO || "";
    const nextAt = entry.atISO || "";
    if (!prevAt || nextAt >= prevAt) latest = entry;
  });
  return latest;
}

function countQuickSignalsForDate(eventLog, dateISO) {
  if (!Array.isArray(eventLog)) return 0;
  return eventLog.filter((entry) => entry?.type === "quick_signal" && entry?.payload?.dateISO === dateISO).length;
}

function shouldPromptForCheckIn({ dayPlan, checkIn, eventLog, dateISO }) {
  const confidence = dayPlan?.meta?.confidence ?? 0.6;
  if (confidence < 0.55) {
    return { shouldPrompt: true, reason: "A quick check-in helps personalize today." };
  }
  const quickSignals = countQuickSignalsForDate(eventLog, dateISO);
  if (quickSignals >= 2) {
    return { shouldPrompt: true, reason: "We can tune today with a quick check-in." };
  }
  if (!checkIn) {
    return { shouldPrompt: true, reason: "Share a quick check-in to adjust today." };
  }
  if (checkIn.atISO) {
    const last = new Date(checkIn.atISO).getTime();
    if (Number.isFinite(last) && Date.now() - last > 24 * 60 * 60 * 1000) {
      return { shouldPrompt: true, reason: "It’s been a bit—refresh today with a quick check-in." };
    }
  }
  return { shouldPrompt: false, reason: null };
}

function shortRationaleFor({ focus, driver }) {
  const focusLabel = focus === "downshift" ? "Downshift" : focus === "rebuild" ? "Rebuild" : "Stabilize";
  if (!driver) return `${focusLabel} today to support recovery.`;
  const trimmed = driver.trim();
  const normalized = trimmed ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : "today’s signals";
  return `${focusLabel} today because ${normalized}.`;
}

function buildWhyNot({ dayPlan, checkIn, safety }) {
  const reasons = [];
  if (safety?.level === "block") {
    reasons.push("Not intensity today because safety signals are active.");
  }
  if (checkIn?.timeAvailableMin != null && Number(checkIn.timeAvailableMin) <= 10) {
    reasons.push("Not a longer session because time available is limited.");
  }
  if (checkIn?.sleepQuality != null && Number(checkIn.sleepQuality) <= 5) {
    reasons.push("Not intensity today because sleep quality was low.");
  }
  if (checkIn?.energy != null && Number(checkIn.energy) <= 4) {
    reasons.push("Not intensity today because energy is low.");
  }
  if (dayPlan?.workout === null) {
    reasons.push("Not a workout today because gentle recovery is prioritized.");
  }
  return reasons.slice(0, 2);
}

function focusStatementFor(dayPlan) {
  const focus = dayPlan?.focus;
  if (!focus) return null;
  if (focus === "downshift") return "Today is about downshifting and protecting recovery.";
  if (focus === "stabilize") return "Today is about stabilizing energy and stress.";
  if (focus === "rebuild") return "Today is about rebuilding capacity with steady momentum.";
  return `Today focuses on ${focus}.`;
}

function buildWhatWouldChange({ dayPlan, checkIn, drivers, appliedRules }) {
  const bullets = [];
  const sleep = Number(checkIn?.sleepQuality || 0);
  const stress = Number(checkIn?.stress || 0);
  const timeMin = Number(checkIn?.timeAvailableMin || 0);
  const focus = dayPlan?.focus || "stabilize";
  const rules = new Set(appliedRules || []);

  if (sleep > 0 && sleep <= 6) {
    bullets.push("Higher sleep quality would allow longer movement.");
  }
  if (timeMin > 0 && timeMin <= 20) {
    bullets.push("More time available would increase the workout dose.");
  }
  if (stress >= 7 || rules.has("recovery_debt_bias")) {
    bullets.push("Lower stress would shift focus toward stabilize or rebuild.");
  }
  if (focus === "downshift" && sleep >= 7 && stress <= 5) {
    bullets.push("Lower stress plus steady sleep would move today toward rebuild.");
  }
  if (!bullets.length && drivers?.length) {
    bullets.push("A steadier day would reduce the need for downshift signals.");
  }
  return bullets.slice(0, 4);
}

function pushCitation(list, id) {
  if (!id) return;
  if (!list.includes(id)) list.push(id);
}

function buildCitations(dayPlan) {
  const citations = [];
  if (dayPlan?.anchors?.sunlightAnchor) {
    pushCitation(citations, "sunlight_circadian");
  }
  const resetTags = Array.isArray(dayPlan?.reset?.tags) ? dayPlan.reset.tags : [];
  if (resetTags.some((tag) => tag === "breathe" || tag === "downshift" || tag === "panic_mode")) {
    pushCitation(citations, "breathing_downshift");
  }
  if (dayPlan?.focus === "downshift" || dayPlan?.focus === "stabilize") {
    pushCitation(citations, "cortisol_rhythm");
  }
  return citations.slice(0, 3);
}

export function toDayContract(state, dateISO, domain) {
  void domain;
  const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
  const workout = dayPlan?.workout === null ? null : dayPlan?.workout || {};
  const reset = dayPlan?.reset || {};
  const nutrition = dayPlan?.nutrition || {};
  const checkIn = latestCheckInForDate(state.checkIns, dateISO);
  const workoutMinutes = workout ? workout.minutes || 0 : 0;
  const resetMinutes = reset.minutes || 0;
  const prompt = shouldPromptForCheckIn({ dayPlan, checkIn, eventLog: state.eventLog, dateISO });
  const safety = { ...(dayPlan?.safety || { level: "ok", reasons: [] }) };
  if (safety.level === "block" || safety.reasons?.includes?.("panic")) {
    safety.disclaimer = "If symptoms feel severe or unsafe, consider professional support.";
  }
  const drivers = state.lastStressStateByDate?.[dateISO]?.drivers || [];
  const driversTop2 = drivers.slice(0, 2);
  const shortRationale = shortRationaleFor({ focus: dayPlan?.focus, driver: driversTop2[0] }).slice(0, 160);
  const whyNot = buildWhyNot({ dayPlan, checkIn, safety });
  const packMatch = dayPlan?.meta?.packMatch || { packId: null, score: 0, topMatchedTags: [] };
  const confidence = dayPlan?.meta?.confidence ?? null;
  const relevance = dayPlan?.meta?.relevance ?? null;
  const appliedRules = dayPlan?.meta?.appliedRules || [];
  const whatWouldChange = buildWhatWouldChange({ dayPlan, checkIn, drivers, appliedRules });
  const citations = buildCitations(dayPlan);
  const reEntryMeta = dayPlan?.meta?.reEntry || null;
  const reEntry =
    reEntryMeta && reEntryMeta.active
      ? {
          active: true,
          dayIndex: reEntryMeta.dayIndex || 1,
          message: `Gentle re-entry day ${reEntryMeta.dayIndex || 1} of 3.`,
        }
      : null;

  return {
    dateISO,
    what: {
      workout: workout
        ? {
            id: workout.id || null,
            title: workout.title || null,
            minutes: workout.minutes ?? null,
            window: dayPlan?.workoutWindow || null,
          }
        : null,
      reset: {
        id: reset.id || null,
        title: reset.title || null,
        minutes: reset.minutes ?? null,
      },
      nutrition: {
        id: nutrition.id || null,
        title: nutrition.title || null,
      },
    },
    why: {
      profile: dayPlan?.profile || null,
      focus: dayPlan?.focus || null,
      driversTop2,
      shortRationale,
      packMatch,
      confidence,
      relevance,
      whatWouldChange,
      whyNot,
      reEntry,
      expanded: {
        drivers,
        appliedRules,
        anchors: dayPlan?.anchors || null,
        safety,
        rationale: (dayPlan?.rationale || []).slice(0, 4),
      },
      statement: focusStatementFor(dayPlan),
      rationale: (dayPlan?.rationale || []).slice(0, 2),
      meta: dayPlan?.meta || null,
      safety,
      checkInPrompt: prompt,
    },
    howLong: {
      totalMinutes: workoutMinutes + resetMinutes,
      timeAvailableMin: checkIn?.timeAvailableMin ?? null,
    },
    details: {
      workoutSteps: Array.isArray(workout?.steps) ? workout.steps : [],
      resetSteps: Array.isArray(reset?.steps) ? reset.steps : [],
      nutritionPriorities: Array.isArray(nutrition?.priorities) ? nutrition.priorities : [],
      anchors: dayPlan?.anchors || null,
      citations,
    },
  };
}
