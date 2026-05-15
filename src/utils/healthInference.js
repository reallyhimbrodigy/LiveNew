// Turn a raw HealthKit snapshot into the same labels Iris would otherwise
// ask the user for. When Apple Health is granted we skip those questions
// entirely — the data is more accurate than self-report anyway.
//
// Returns:
//   { sleepQuality: 'great'|'okay'|'rough'|null,
//     energy:       'high' |'medium'|'low'  |null,
//     summary:      string|null }  // human-readable "what Iris read"

export function deriveFromHealth(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { sleepQuality: null, energy: null, summary: null };
  }

  // Sleep — straightforward thresholds on minutes.
  let sleepQuality = null;
  const sleepMin = Number.isFinite(snapshot.sleepLastNightMinutes)
    ? snapshot.sleepLastNightMinutes
    : null;
  if (sleepMin != null) {
    if (sleepMin >= 7.5 * 60) sleepQuality = 'great';
    else if (sleepMin >= 6 * 60) sleepQuality = 'okay';
    else sleepQuality = 'rough';
  }

  // Energy — composite signal from HRV and RHR deltas vs the user's baseline.
  // HRV up + RHR flat/down = recovered → high.
  // HRV down or RHR up by several bpm = sympathetic load → low.
  // Otherwise → medium.
  let energy = null;
  const hrvDelta = Number.isFinite(snapshot.hrvDeltaPct) ? snapshot.hrvDeltaPct : null;
  const rhrDelta = Number.isFinite(snapshot.rhrDelta) ? snapshot.rhrDelta : null;
  if (hrvDelta != null || rhrDelta != null) {
    let score = 0;
    if (hrvDelta != null) {
      if (hrvDelta >= 5) score += 1;
      else if (hrvDelta <= -10) score -= 1;
    }
    if (rhrDelta != null) {
      if (rhrDelta <= -2) score += 1;
      else if (rhrDelta >= 5) score -= 1;
    }
    energy = score >= 1 ? 'high' : score <= -1 ? 'low' : 'medium';
  }

  // Human-readable summary for the UI ("I read your sleep — 6h 44m. HRV down 8% from baseline.")
  const parts = [];
  if (sleepMin != null) {
    const hrs = Math.floor(sleepMin / 60);
    const mins = sleepMin % 60;
    parts.push(`${hrs}h ${mins}m of sleep`);
  }
  if (hrvDelta != null) {
    if (Math.abs(hrvDelta) >= 3) {
      parts.push(hrvDelta > 0 ? `HRV up ${hrvDelta}%` : `HRV down ${Math.abs(hrvDelta)}%`);
    }
  }
  if (rhrDelta != null && Math.abs(rhrDelta) >= 2) {
    const sign = rhrDelta >= 0 ? '+' : '';
    parts.push(`resting HR ${sign}${rhrDelta} bpm`);
  }
  const summary = parts.length > 0 ? parts.join(', ') + '.' : null;

  return { sleepQuality, energy, summary };
}

// Whether we have enough HealthKit data to skip the sleep + energy questions.
// We need BOTH derivations to be confident in skipping — partial data falls
// back to asking, so the user is never stranded.
export function canSkipSleepAndEnergy(snapshot) {
  const d = deriveFromHealth(snapshot);
  return d.sleepQuality != null && d.energy != null;
}
