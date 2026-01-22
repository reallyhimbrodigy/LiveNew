export function sevenDayAvgStress(checkIns) {
  const sorted = [...checkIns].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const seen = new Set();
  let sum = 0;
  let count = 0;

  for (const c of sorted) {
    if (seen.has(c.dateISO)) continue;
    seen.add(c.dateISO);
    sum += c.stress;
    count += 1;
    if (count >= 7) break;
  }

  if (count === 0) return null;
  return sum / count;
}

export function adherencePercent(weekPlan, completions) {
  const totalBlocks = weekPlan.days.reduce((sum, day) => sum + day.blocks.length, 0);
  if (totalBlocks === 0) return 0;

  let doneBlocks = 0;
  for (const day of weekPlan.days) {
    for (const block of day.blocks) {
      if (completions[block.id]) doneBlocks += 1;
    }
  }

  return Math.round((doneBlocks / totalBlocks) * 100);
}
