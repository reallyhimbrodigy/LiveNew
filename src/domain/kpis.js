export function computeProgress({ checkIns, weekPlan, completions }) {
  const stressAvg7 = averageLast7(checkIns, "stress");
  const sleepAvg7 = averageLast7(checkIns, "sleepQuality");
  const adherencePct = computeAdherence(weekPlan, completions);
  const downshiftMinutes7 = computeDownshiftMinutes(weekPlan);
  const stressTrend = buildTrend(checkIns, "stress");
  const consistency = buildConsistency(checkIns, completions);
  const wins = buildWins({ stressTrend, consistency, stressAvg7 });

  return { stressAvg7, sleepAvg7, adherencePct, downshiftMinutes7, stressTrend, consistency, wins };
}

function averageLast7(checkIns, key) {
  const sorted = [...checkIns].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const seen = new Set();
  let sum = 0;
  let count = 0;

  for (const c of sorted) {
    if (seen.has(c.dateISO)) continue;
    seen.add(c.dateISO);
    const value = Number(c[key]);
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
    if (count >= 7) break;
  }

  if (count === 0) return null;
  return sum / count;
}

function computeAdherence(weekPlan, completions) {
  if (!weekPlan || !weekPlan.days) return null;
  const completionKeys = completions ? Object.keys(completions) : [];
  if (!completionKeys.length) return null;
  return null;
}

function computeDownshiftMinutes(weekPlan) {
  if (!weekPlan || !Array.isArray(weekPlan.days)) return null;
  const days = [...weekPlan.days].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 7);
  let sum = 0;
  days.forEach((day) => {
    if (day.focus === "downshift") {
      sum += (day.workout?.minutes || 0) + (day.reset?.minutes || 0);
    }
  });
  return sum;
}

function buildTrend(checkIns, key) {
  const sorted = [...checkIns].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const seen = new Map();
  for (const c of sorted) {
    const date = c.dateISO || c.dateKey || c.date_key;
    if (!date) continue;
    const value = Number(c[key]);
    if (!Number.isFinite(value)) continue;
    seen.set(date, value);
  }
  return Array.from(seen.entries()).map(([date, value]) => ({ date, value }));
}

function buildConsistency(checkIns, completions) {
  const uniqueDates = new Set();
  for (const c of checkIns) {
    const date = c.dateISO || c.dateKey || c.date_key;
    if (date) uniqueDates.add(date);
  }

  let resetsCompleted = 0;
  let movementCompleted = 0;
  if (completions && typeof completions === "object") {
    for (const dateKey of Object.keys(completions)) {
      const day = completions[dateKey];
      if (day?.reset) resetsCompleted++;
      if (day?.movement) movementCompleted++;
    }
  }

  return {
    checkinDays: uniqueDates.size,
    resetsCompleted,
    movementCompleted,
  };
}

function buildWins({ stressTrend, consistency, stressAvg7 }) {
  void stressAvg7;
  const wins = [];

  if (consistency.checkinDays >= 3) {
    wins.push(`You've checked in ${consistency.checkinDays} days. That consistency is building a picture of your stress patterns.`);
  }

  if (stressTrend.length >= 3) {
    const recent3 = stressTrend.slice(-3);
    const earlier3 = stressTrend.slice(-6, -3);
    if (earlier3.length >= 3) {
      const recentAvg = recent3.reduce((sum, point) => sum + point.value, 0) / recent3.length;
      const earlierAvg = earlier3.reduce((sum, point) => sum + point.value, 0) / earlier3.length;
      const pctChange = Math.round(((earlierAvg - recentAvg) / earlierAvg) * 100);
      if (pctChange > 0) {
        wins.push(`Your stress dropped ${pctChange}% over the last few days.`);
      }
    }
  }

  if (consistency.resetsCompleted >= 3) {
    wins.push(`${consistency.resetsCompleted} resets completed. Each one trained your nervous system to downregulate faster.`);
  }

  if (consistency.movementCompleted >= 3) {
    wins.push(`${consistency.movementCompleted} movement sessions done. Your body is learning what regulation feels like.`);
  }

  return wins;
}
