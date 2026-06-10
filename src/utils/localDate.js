/**
 * Returns today's date as YYYY-MM-DD in the device's local timezone.
 * This matches the server's date key logic (which uses the user's timezone)
 * and avoids the UTC mismatch from toISOString().slice(0, 10).
 */
export function getLocalDateISO(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns yesterday's date as YYYY-MM-DD in local timezone.
 */
export function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateISO(d);
}

/**
 * Returns the day before yesterday as YYYY-MM-DD in local timezone.
 * Used by the streak-freeze resolver to detect a single missed day.
 */
export function getDayBeforeYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return getLocalDateISO(d);
}

/**
 * Returns the ISO-week identifier for a given date as the Monday date of that
 * week in 'YYYY-MM-DD' format.  This is the simplest stable per-week string
 * that requires no locale logic and is easy to compute and compare.
 * @param {Date} [date]
 * @returns {string} Monday's 'YYYY-MM-DD' for the week that contains date.
 */
export function getWeekIdISO(date) {
  const d = date ? new Date(date) : new Date();
  // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat. Shift so Monday=0.
  const dayOfWeek = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
  d.setDate(d.getDate() - dayOfWeek);
  return getLocalDateISO(d);
}

/**
 * The "logical day" the user is currently in for purposes of their plan.
 * Calendar midnight is the wrong boundary — a plan generated at 11pm should
 * still be valid at 2am (the user hasn't slept yet, the day hasn't really
 * ended). We treat 00:00-04:59 as still belonging to the PREVIOUS day, so
 * a plan saved at 11pm is still hydrated when the user opens the app at 3am.
 *
 * The day rolls over at 5am — when the sleep window closes and the morning
 * cortisol pulse begins. This matches the sleep-window logic (22:00-05:00)
 * and the human experience of "what day is it" when you're awake at night.
 *
 * Use this for plan persistence / hydration / cache keys. Use getLocalDateISO
 * for calendar-truthful things (yesterday's reflection key, streak math,
 * greeting "good morning vs evening").
 */
export function getLogicalDateISO() {
  const now = new Date();
  if (now.getHours() < 5) {
    // It's between midnight and 5am — treat as still yesterday.
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return getLocalDateISO(yesterday);
  }
  return getLocalDateISO(now);
}

/**
 * True when the device clock is inside the sleep window (22:00-05:00 local).
 * Used to suppress plan generation, auto-routing into check-in, and other
 * "this is daytime" UI flows. Single helper so the boundary is defined in
 * exactly one place.
 */
export function isSleepWindow(date) {
  const h = (date || new Date()).getHours();
  return h >= 22 || h < 5;
}
