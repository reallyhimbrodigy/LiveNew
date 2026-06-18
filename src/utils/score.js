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

// Today's state is the BULK of the score (max 87 self-report) so that feeling
// good/rested/energized actually reads as a high score. Trend + consistency are
// small bonuses on top — they never penalize someone with no history (the old
// math capped a perfect-mood new user at ~77, which felt broken).
const STRESS_PTS = { good: 38, okay: 24, stressed: 11, overwhelmed: 2 };
const SLEEP_PTS  = { great: 34, okay: 20, rough: 7 };
const ENERGY_PTS = { high: 15, medium: 9, low: 4 };

export function computeScore({ stressLabel, sleepQuality, energy, behaviorProfile, stressTrend, healthSnapshot }) {
  const hasHealth = healthSnapshot && (
    healthSnapshot.sleepLastNightMinutes != null ||
    healthSnapshot.hrvLast7Avg != null ||
    healthSnapshot.rhrLast7Avg != null
  );

  const stressPts = (stressLabel && STRESS_PTS[stressLabel] != null) ? STRESS_PTS[stressLabel] : 24;
  const sleepPts  = (sleepQuality && SLEEP_PTS[sleepQuality] != null) ? SLEEP_PTS[sleepQuality] : 20;
  const energyPts = (energy && ENERGY_PTS[energy] != null) ? ENERGY_PTS[energy] : 9;

  let score = 0;

  if (hasHealth) {
    // Biometric-led: real sleep / HRV / RHR are the spine; reported state
    // modulates. Reaches the low-90s when biometrics + mood are all good.
    const sleepMin = healthSnapshot.sleepLastNightMinutes;
    if (sleepMin != null) {
      score += Math.max(0, Math.min(28, 28 - Math.round(Math.abs(sleepMin - 450) / 10))); // 0–28
    } else {
      score += Math.round(sleepPts * 0.8);
    }
    const avg7 = healthSnapshot.sleepLast7Avg;
    score += avg7 != null ? Math.max(0, 6 - Math.round(Math.abs(avg7 - 450) / 30)) : 4;     // 0–6
    if (healthSnapshot.hrvDeltaPct != null) {
      score += Math.max(0, Math.min(24, 15 + Math.round(healthSnapshot.hrvDeltaPct * 0.45))); // 0–24
    } else if (healthSnapshot.hrvLast7Avg != null) { score += 14; } else { score += 12; }
    if (healthSnapshot.rhrDelta != null) {
      score += Math.max(0, Math.min(14, 11 - Math.round(healthSnapshot.rhrDelta)));          // 0–14
    } else if (healthSnapshot.rhrLast7Avg != null) { score += 9; } else { score += 8; }
    score += Math.round(stressPts * (14 / 38)); // reported stress, scaled 0–14
    score += Math.round(energyPts * (6 / 15));  // reported energy, scaled 0–6
  } else {
    // Self-report: today's state IS the score.
    score = stressPts + sleepPts + energyPts; // max 87
    // Trend is a light bonus, neutral (5) when there isn't enough history.
    let trendBonus = 5;
    if (Array.isArray(stressTrend) && stressTrend.length >= 4) {
      const recent = stressTrend.slice(-3).map((t) => t.stress ?? 5);
      const older = stressTrend.slice(-7, -3).map((t) => t.stress ?? 5);
      if (recent.length && older.length) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        trendBonus = Math.max(0, Math.min(8, 5 + (olderAvg - recentAvg) * 3));
      }
    }
    score += trendBonus;
  }

  // Consistency — a SMALL bonus, never the bulk, so a great day always reads
  // high even for a brand-new user. (The client doesn't pass behaviorProfile,
  // so this is the neutral default there.)
  if (behaviorProfile) {
    score += Math.min(6, Math.round((behaviorProfile.streak || 0) * 0.7) + Math.min(3, Math.round((behaviorProfile.totalItemsDoneLast14 || 0) * 0.2)));
  } else {
    score += 3;
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
