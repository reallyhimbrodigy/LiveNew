/**
 * Actionable cortisol-lowering recommendations — "what you can do" half of
 * the feedback system. Distinct from cortisolFacts.js (consequence-based
 * motivators); these are positive, doable actions Iris surfaces as suggestions.
 *
 * Each recommendation is grounded in cortisol-regulation research and written
 * in the calm, direct tone Iris uses throughout the app.
 */
export const RECOMMENDATIONS = [
  {
    id: 'morning_sun',
    title: 'Get 10 minutes of morning sun.',
    why: 'Early light anchors your cortisol rhythm so it peaks and falls on time.',
    tag: 'light',
    timeOfDay: 'morning',
  },
  {
    id: 'caffeine_timing',
    title: 'Hold caffeine 90 minutes after waking.',
    why: 'Caffeine on top of your natural cortisol peak spikes it higher and crashes you harder.',
    tag: 'nutrition',
    timeOfDay: 'morning',
  },
  {
    id: 'morning_movement',
    title: 'Move your body before you check your phone.',
    why: 'Light morning movement clears overnight cortisol before the day stacks more on top.',
    tag: 'movement',
    timeOfDay: 'morning',
  },
  {
    id: 'walk_outside',
    title: 'Take a walk outside.',
    why: 'Zone-2 movement in nature measurably lowers cortisol.',
    tag: 'movement',
    timeOfDay: 'day',
  },
  {
    id: 'daylight_break',
    title: 'Step outside for five minutes mid-day.',
    why: 'A brief daylight break resets alertness and blunts the early-afternoon cortisol dip.',
    tag: 'light',
    timeOfDay: 'day',
  },
  {
    id: 'meal_timing',
    title: 'Eat a real meal before 1pm.',
    why: 'Skipping midday food signals scarcity to the body, which keeps cortisol elevated.',
    tag: 'nutrition',
    timeOfDay: 'day',
  },
  {
    id: 'wind_down',
    title: 'Protect your wind-down.',
    why: 'A consistent pre-sleep routine drops evening cortisol so melatonin can rise.',
    tag: 'sleep',
    timeOfDay: 'evening',
  },
  {
    id: 'screens_off',
    title: 'Put the phone down 30 minutes before bed.',
    why: 'Late blue light and doomscrolling keep evening cortisol elevated.',
    tag: 'sleep',
    timeOfDay: 'evening',
  },
  {
    id: 'dim_lights',
    title: 'Dim your lights after 8pm.',
    why: 'Bright indoor light in the evening suppresses melatonin and keeps cortisol higher than it should be.',
    tag: 'sleep',
    timeOfDay: 'evening',
  },
  {
    id: 'breathwork',
    title: 'Do one slow exhale-focused minute.',
    why: 'Long exhales flip you into the parasympathetic state that clears cortisol.',
    tag: 'breathwork',
    timeOfDay: 'any',
  },
  {
    id: 'cold_shower',
    title: 'End your shower with 30 seconds cold.',
    why: 'A brief cold stressor trains a faster cortisol recovery response.',
    tag: 'recovery',
    timeOfDay: 'any',
  },
  {
    id: 'social',
    title: 'Text one person you like.',
    why: 'Real social connection is one of the strongest cortisol buffers.',
    tag: 'social',
    timeOfDay: 'any',
  },
];

const _length = RECOMMENDATIONS.length;

/**
 * Look up a recommendation by its id. Returns undefined if not found.
 * @param {string} id
 */
export function recById(id) {
  return RECOMMENDATIONS.find((r) => r.id === id);
}

/**
 * Pick a day-stable recommendation, optionally biased to the current time
 * of day. Prefers recs matching the time-of-day bucket or tagged 'any',
 * then falls back to the full list. The selection is stable within a
 * calendar day — it won't change on re-render or between app opens.
 *
 * @param {Date} date - Defaults to now. Pass a specific Date for testing.
 * @returns {object} A single recommendation object.
 */
export function recForToday(date = new Date()) {
  const h = date.getHours();
  const bucket = h < 11 ? 'morning' : h < 17 ? 'day' : 'evening';

  // Prefer recs matching the current time-of-day bucket, plus 'any' recs.
  const pool = RECOMMENDATIONS.filter(
    (r) => r.timeOfDay === bucket || r.timeOfDay === 'any'
  );

  // Day-stable index: changes once per calendar day, stable across renders.
  const dayIndex = Math.floor(date.getTime() / 86400000);
  const arr = pool.length > 0 ? pool : RECOMMENDATIONS;
  return arr[dayIndex % arr.length];
}
