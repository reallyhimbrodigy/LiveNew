const HIGH_PM = {
  title: "Evening nervous-system reset",
  tags: ["movement", "breath", "sleep", "recovery"],
  instructions: [
    "Choose low-intensity movement: walk, yoga, or zone-2 easy pace.",
    "Finish with 5 minutes slow breathing or legs-up-the-wall.",
    "Keep screens dim in the last hour if possible.",
  ],
};

export function adaptWeekPlan(weekPlan, baseline, checkIns) {
  void baseline;
  const sorted = [...checkIns].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const recent = sorted.slice(0, 3);
  if (recent.length === 0) return weekPlan;

  const avgStress = recent.reduce((sum, c) => sum + c.stress, 0) / recent.length;
  const avgSleepQuality = recent.reduce((sum, c) => sum + c.sleepQuality, 0) / recent.length;

  let nextFocus = null;
  let replacePM = false;

  if (avgStress >= 7 && avgSleepQuality <= 5) {
    nextFocus = "downshift";
    replacePM = true;
  } else if (avgStress >= 4 && avgStress <= 6) {
    nextFocus = "stabilize";
  } else if (avgStress <= 3 && avgSleepQuality >= 7) {
    nextFocus = "rebuild";
  } else {
    return weekPlan;
  }

  const tomorrowISO = addDaysISO(new Date().toISOString().slice(0, 10), 1);
  if (!weekPlan.days.some((d) => d.dateISO === tomorrowISO)) return weekPlan;
  return updateDayPlan(weekPlan, tomorrowISO, nextFocus, replacePM);
}

export function applyStressorToWeekPlan(weekPlan, dateISO) {
  return updateDayPlan(weekPlan, dateISO, "downshift", true);
}

function updateDayPlan(
  weekPlan,
  dateISO,
  focus,
  replacePM
) {
  let changed = false;
  const days = weekPlan.days.map((day) => {
    if (day.dateISO !== dateISO) return day;

    let blocks = day.blocks;
    if (replacePM) {
      blocks = day.blocks.map((b) => (b.window === "PM" ? withHighPM(b) : b));
    }

    changed = true;
    return { ...day, focus, blocks };
  });

  if (!changed) return weekPlan;
  return { ...weekPlan, days };
}

function withHighPM(block) {
  return {
    ...block,
    title: HIGH_PM.title,
    tags: HIGH_PM.tags,
    instructions: HIGH_PM.instructions,
  };
}

function addDaysISO(startISO, days) {
  const d = new Date(`${startISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
