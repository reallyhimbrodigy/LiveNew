/**
 * schedule.js — pure schedule domain logic
 *
 * Schedule shape:
 *   { version: 1,
 *     blocks: [{ id, type, label, start:"HH:MM", end:"HH:MM"|null, days:number[] }],
 *     wake:  { source:"health"|"manual", weekday:"HH:MM"|null, weekend:"HH:MM"|null } | null,
 *     sleep: { source, weekday, weekend } | null,
 *     meals: { breakfast, lunch, dinner } }
 *
 * days[] uses 0=Mon … 6=Sun throughout.
 */

// ── dayIndex ──────────────────────────────────────────────────────────────────

/**
 * Convert a JS Date to 0=Mon … 6=Sun.
 * This is the ONLY place the JS getDay() → schedule day mapping lives.
 */
export function dayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

// ── normalizeSchedule ─────────────────────────────────────────────────────────

export const DEFAULT_MEALS = { breakfast: "08:00", lunch: "12:30", dinner: "19:00" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isHHMM = (v) => typeof v === "string" && HHMM.test(v);

const isValidBlock = (b) =>
  b && typeof b === "object" &&
  typeof b.label === "string" && b.label.trim().length > 0 &&
  isHHMM(b.start) &&
  (b.end == null || isHHMM(b.end)) &&
  Array.isArray(b.days) && b.days.length > 0 && b.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

const cleanTime = (t) => {
  if (!t || typeof t !== "object") return null;
  return {
    source: t.source === "health" ? "health" : "manual",
    weekday: isHHMM(t.weekday) ? t.weekday : null,
    weekend: isHHMM(t.weekend) ? t.weekend : null,
  };
};

/**
 * Return a safe, fully-formed schedule from raw (possibly null) input.
 * Drops malformed blocks; fills missing meals from DEFAULT_MEALS.
 */
export function normalizeSchedule(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const blocks = Array.isArray(src.blocks) ? src.blocks.filter(isValidBlock) : [];
  const meals = Object.fromEntries(
    ["breakfast", "lunch", "dinner"].map((k) => {
      const v = src.meals?.[k];
      return [k, isHHMM(v) ? v : DEFAULT_MEALS[k]];
    })
  );
  return {
    version: 1,
    blocks,
    wake: cleanTime(src.wake),
    sleep: cleanTime(src.sleep),
    meals,
  };
}

// ── resolveDaySchedule ────────────────────────────────────────────────────────

const WEEKDAY_TO_INDEX = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };

// Resolve a schedule to the concrete facts for a given calendar day.
// `timezone` (IANA, e.g. "America/Los_Angeles") makes the weekday reflect the
// USER's local date, not the server's. Falls back to the runtime's local zone.
export function resolveDaySchedule(schedule, date = new Date(), { timezone } = {}) {
  if (!schedule || typeof schedule !== "object" || !Array.isArray(schedule.blocks)) return null;
  const weekdayName = date.toLocaleDateString("en-US", {
    weekday: "long",
    ...(timezone ? { timeZone: timezone } : {}),
  });
  const di = WEEKDAY_TO_INDEX[weekdayName];
  const isWeekend = di >= 5;
  const commitments = schedule.blocks
    .filter((b) => Array.isArray(b.days) && b.days.includes(di))
    .map((b) => ({ label: b.label, start: b.start, end: b.end || null }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const pick = (field) => {
    const f = schedule[field];
    if (!f) return null;
    return isWeekend && f.weekend ? f.weekend : f.weekday || null;
  };
  return {
    weekdayName,
    isWeekend,
    commitments,
    wake: pick("wake"),
    sleep: pick("sleep"),
    meals: schedule.meals || DEFAULT_MEALS,
  };
}

// ── deriveRoutineSummary ──────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days) {
  const set = [...days].sort((a, b) => a - b);
  const key = set.join(",");
  if (set.length === 7) return "every day";
  if (key === "0,1,2,3,4") return "weekdays";
  if (key === "5,6") return "weekends";
  return set.map((d) => DAY_LABELS[d]).join("/");
}

/**
 * Produce a human-readable string for the legacy `routine` field.
 * e.g. "wake 06:40, Work 09:00-17:00 (weekdays), Gym 18:00-19:00 (Tue/Thu/Sat)"
 */
export function deriveRoutineSummary(schedule) {
  if (!schedule || !Array.isArray(schedule.blocks)) return "";
  const parts = schedule.blocks.map((b) => {
    const time = b.end ? `${b.start}-${b.end}` : b.start;
    return `${b.label} ${time} (${formatDays(b.days)})`;
  });
  // weekday times only; weekend variation is handled by resolveDaySchedule
  const wake = schedule.wake?.weekday ? `wake ${schedule.wake.weekday}` : null;
  const sleep = schedule.sleep?.weekday ? `sleep ${schedule.sleep.weekday}` : null;
  return [wake, ...parts, sleep].filter(Boolean).join(", ");
}
