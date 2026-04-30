// LiveNew score (0–100) — a behavior + state index, not a real cortisol
// measurement. Honest about that in the UI.
//
// Components (each contributes to the final score):
//   - Sleep quality       (0–25)   strongest signal until HealthKit lands
//   - Stress today        (0–25)   inverted; stressed=0, good=25
//   - Energy today        (0–15)
//   - Recent stress trend (0–15)   downtrending stress earns points
//   - Plan compliance     (0–10)   from behavior profile
//   - Streak factor       (0–10)   small reward for showing up
//
// Inputs come from authStore + behaviorProfile (when available).

const STRESS_TO_NUMERIC = { good: 25, okay: 16, stressed: 8, overwhelmed: 0 };
const SLEEP_TO_NUMERIC = { great: 25, okay: 14, rough: 5 };
const ENERGY_TO_NUMERIC = { high: 15, medium: 9, low: 4 };

export function computeScore({ stressLabel, sleepQuality, energy, behaviorProfile, stressTrend }) {
  let score = 0;

  // Today's check-in inputs
  if (stressLabel && STRESS_TO_NUMERIC[stressLabel] != null) {
    score += STRESS_TO_NUMERIC[stressLabel];
  } else {
    score += 12; // neutral default
  }
  if (sleepQuality && SLEEP_TO_NUMERIC[sleepQuality] != null) {
    score += SLEEP_TO_NUMERIC[sleepQuality];
  } else {
    score += 12;
  }
  if (energy && ENERGY_TO_NUMERIC[energy] != null) {
    score += ENERGY_TO_NUMERIC[energy];
  } else {
    score += 7;
  }

  // Recent stress trend — improving earns points, worsening loses them
  if (Array.isArray(stressTrend) && stressTrend.length >= 4) {
    const recent = stressTrend.slice(-3).map((t) => t.stress ?? 5);
    const older = stressTrend.slice(-7, -3).map((t) => t.stress ?? 5);
    if (recent.length > 0 && older.length > 0) {
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
      const delta = olderAvg - recentAvg; // positive = stress dropping
      const trendPoints = Math.max(0, Math.min(15, 7 + delta * 3));
      score += trendPoints;
    } else {
      score += 7;
    }
  } else {
    score += 7; // neutral when not enough trend data
  }

  // Plan compliance from behavior profile
  if (behaviorProfile) {
    const total = behaviorProfile.totalItemsDoneLast14 || 0;
    // 0 = 0 points, 5 = ~3 points, 15 = ~7 points, 25+ = 10 points
    const compliancePoints = Math.min(10, Math.round(total * 0.4));
    score += compliancePoints;
    const streakPoints = Math.min(10, Math.round((behaviorProfile.streak || 0) * 1.5));
    score += streakPoints;
  } else {
    score += 5; // neutral default
    score += 0;
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
