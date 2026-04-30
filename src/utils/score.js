// LiveNew score (0–100). Behavior + state + biometric index.
//
// When HealthKit is connected, real sleep / RHR / HRV dominate the calculation.
// When it isn't, falls back to self-report.
//
// Self-report mode (no HealthKit):
//   Sleep quality       (0–25)
//   Stress today        (0–25)
//   Energy today        (0–15)
//   Stress trend        (0–15)
//   Compliance + streak (0–20)
//
// HealthKit mode (snapshot present):
//   Sleep duration (last night vs 7d avg)   (0–22)
//   Sleep duration baseline                 (0–8)
//   HRV vs 30d baseline                     (0–22)
//   RHR vs baseline (inverted)              (0–13)
//   Stress / energy reported                (0–15)
//   Compliance + streak                     (0–20)

const STRESS_TO_NUMERIC = { good: 25, okay: 16, stressed: 8, overwhelmed: 0 };
const SLEEP_TO_NUMERIC = { great: 25, okay: 14, rough: 5 };
const ENERGY_TO_NUMERIC = { high: 15, medium: 9, low: 4 };

export function computeScore({ stressLabel, sleepQuality, energy, behaviorProfile, stressTrend, healthSnapshot }) {
  let score = 0;
  const hasHealth = healthSnapshot && (
    healthSnapshot.sleepLastNightMinutes != null ||
    healthSnapshot.hrvLast7Avg != null ||
    healthSnapshot.rhrLast7Avg != null
  );

  if (hasHealth) {
    // Sleep duration last night (target ~7.5h = 450 min)
    const sleepMin = healthSnapshot.sleepLastNightMinutes;
    if (sleepMin != null) {
      // Bell curve around 450 min, max 22 points at 420–480
      const distance = Math.abs(sleepMin - 450);
      const sleepPts = Math.max(0, 22 - Math.round(distance / 12));
      score += Math.min(22, sleepPts);
    } else {
      score += sleepQuality && SLEEP_TO_NUMERIC[sleepQuality] != null
        ? Math.round(SLEEP_TO_NUMERIC[sleepQuality] * 0.88)
        : 11;
    }

    // 7-day sleep average baseline (target same range)
    const avg7 = healthSnapshot.sleepLast7Avg;
    if (avg7 != null) {
      const distance = Math.abs(avg7 - 450);
      score += Math.max(0, 8 - Math.round(distance / 25));
    } else {
      score += 4;
    }

    // HRV vs baseline — positive delta is health, negative is overload
    if (healthSnapshot.hrvDeltaPct != null) {
      // -20% → 0 pts, 0% → 14 pts, +20% → 22 pts
      const pct = healthSnapshot.hrvDeltaPct;
      const hrvPts = Math.max(0, Math.min(22, 14 + Math.round(pct * 0.4)));
      score += hrvPts;
    } else if (healthSnapshot.hrvLast7Avg != null) {
      // Without baseline, give middle credit
      score += 11;
    } else {
      score += 8;
    }

    // RHR vs baseline (inverted — higher = worse)
    if (healthSnapshot.rhrDelta != null) {
      const delta = healthSnapshot.rhrDelta;
      // -3 bpm or lower → 13 pts, 0 → 9, +5 → 4, +10 → 0
      const rhrPts = Math.max(0, Math.min(13, 9 - delta));
      score += rhrPts;
    } else if (healthSnapshot.rhrLast7Avg != null) {
      score += 7;
    } else {
      score += 4;
    }

    // Reported stress / energy (lighter weight when biometrics dominate)
    score += stressLabel && STRESS_TO_NUMERIC[stressLabel] != null
      ? Math.round(STRESS_TO_NUMERIC[stressLabel] * 0.36)
      : 6;
    score += energy && ENERGY_TO_NUMERIC[energy] != null
      ? Math.round(ENERGY_TO_NUMERIC[energy] * 0.4)
      : 4;
  } else {
    // Self-report fallback
    score += stressLabel && STRESS_TO_NUMERIC[stressLabel] != null ? STRESS_TO_NUMERIC[stressLabel] : 12;
    score += sleepQuality && SLEEP_TO_NUMERIC[sleepQuality] != null ? SLEEP_TO_NUMERIC[sleepQuality] : 12;
    score += energy && ENERGY_TO_NUMERIC[energy] != null ? ENERGY_TO_NUMERIC[energy] : 7;

    if (Array.isArray(stressTrend) && stressTrend.length >= 4) {
      const recent = stressTrend.slice(-3).map((t) => t.stress ?? 5);
      const older = stressTrend.slice(-7, -3).map((t) => t.stress ?? 5);
      if (recent.length > 0 && older.length > 0) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        const delta = olderAvg - recentAvg;
        const trendPoints = Math.max(0, Math.min(15, 7 + delta * 3));
        score += trendPoints;
      } else {
        score += 7;
      }
    } else {
      score += 7;
    }
  }

  // Compliance + streak (same weight either mode)
  if (behaviorProfile) {
    const total = behaviorProfile.totalItemsDoneLast14 || 0;
    score += Math.min(10, Math.round(total * 0.4));
    score += Math.min(10, Math.round((behaviorProfile.streak || 0) * 1.5));
  } else {
    score += 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Loose label for the score so the UI can color it appropriately.
export function scoreBand(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid-high';
  if (score >= 40) return 'mid';
  if (score >= 20) return 'mid-low';
  return 'low';
}

// Determine which zone is "current" given the local time. Returns the zone id.
const ZONE_HOURS = [
  { id: 'morning',    start: 5.5, end: 8 },
  { id: 'peak',       start: 8,   end: 11 },
  { id: 'midmorning', start: 11,  end: 12.5 },
  { id: 'lunch',      start: 12.5, end: 14 },
  { id: 'afternoon',  start: 14,  end: 16 },
  { id: 'transition', start: 16,  end: 18 },
  { id: 'winddown',   start: 18,  end: 21 },
  { id: 'sleep',      start: 21,  end: 29.5 }, // wraps past midnight
];

export function getCurrentZoneId(date = new Date()) {
  const hourFloat = date.getHours() + date.getMinutes() / 60;
  // Handle the 0–5.5 gap (very late night / pre-dawn) by mapping to "sleep"
  if (hourFloat < 5.5) return 'sleep';
  for (const z of ZONE_HOURS) {
    const end = z.end > 24 ? z.end - 24 : z.end;
    if (z.end > 24) {
      if (hourFloat >= z.start || hourFloat < end) return z.id;
    } else if (hourFloat >= z.start && hourFloat < z.end) {
      return z.id;
    }
  }
  return 'morning';
}

export const ZONE_ORDER = [
  'morning', 'peak', 'midmorning', 'lunch', 'afternoon', 'transition', 'winddown', 'sleep',
];

export const ZONE_LABELS = {
  morning:    'Morning',
  peak:       'Peak focus',
  midmorning: 'Midmorning dip',
  lunch:      'Lunch',
  afternoon:  'Afternoon dip',
  transition: 'Transition',
  winddown:   'Wind-down',
  sleep:      'Sleep window',
};
