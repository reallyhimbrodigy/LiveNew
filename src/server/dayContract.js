function latestCheckInForDate(checkIns, dateISO) {
  if (!Array.isArray(checkIns)) return null;
  return checkIns.find((entry) => entry.dateISO === dateISO) || null;
}

function focusStatementFor(dayPlan) {
  const focus = dayPlan?.focus;
  if (!focus) return null;
  if (focus === "downshift") return "Today is about downshifting and protecting recovery.";
  if (focus === "stabilize") return "Today is about stabilizing energy and stress.";
  if (focus === "rebuild") return "Today is about rebuilding capacity with steady momentum.";
  return `Today focuses on ${focus}.`;
}

export function toDayContract(state, dateISO, domain) {
  void domain;
  const dayPlan = state.weekPlan?.days?.find((day) => day.dateISO === dateISO) || null;
  const workout = dayPlan?.workout || {};
  const reset = dayPlan?.reset || {};
  const nutrition = dayPlan?.nutrition || {};
  const checkIn = latestCheckInForDate(state.checkIns, dateISO);

  return {
    dateISO,
    what: {
      workout: {
        id: workout.id || null,
        title: workout.title || null,
        minutes: workout.minutes ?? null,
        window: dayPlan?.workoutWindow || null,
      },
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
      drivers: (state.lastStressStateByDate?.[dateISO]?.drivers || []).slice(0, 2),
      statement: focusStatementFor(dayPlan),
      rationale: (dayPlan?.rationale || []).slice(0, 2),
      meta: dayPlan?.meta || null,
    },
    howLong: {
      totalMinutes: (workout.minutes || 0) + (reset.minutes || 0),
      timeAvailableMin: checkIn?.timeAvailableMin ?? null,
    },
    details: {
      workoutSteps: Array.isArray(workout.steps) ? workout.steps : [],
      resetSteps: Array.isArray(reset.steps) ? reset.steps : [],
      nutritionPriorities: Array.isArray(nutrition.priorities) ? nutrition.priorities : [],
      anchors: dayPlan?.anchors || null,
    },
  };
}
