import assert from "node:assert";

// ── Task 1: dayIndex ──────────────────────────────────────────────────────────
import { dayIndex } from "../src/domain/schedule.js";

assert.equal(dayIndex(new Date("2026-06-08T12:00:00")), 0, "Monday -> 0");
assert.equal(dayIndex(new Date("2026-06-13T12:00:00")), 5, "Saturday -> 5");
assert.equal(dayIndex(new Date("2026-06-14T12:00:00")), 6, "Sunday -> 6");
console.log("dayIndex OK");

// ── Task 2: normalizeSchedule + DEFAULT_MEALS ─────────────────────────────────
import { normalizeSchedule, DEFAULT_MEALS } from "../src/domain/schedule.js";

const empty = normalizeSchedule(null);
assert.deepEqual(empty.blocks, [], "null -> empty blocks");
assert.deepEqual(empty.meals, DEFAULT_MEALS, "null -> default meals");

const n = normalizeSchedule({
  blocks: [
    { id: "a", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
    { id: "b", label: "", start: "bad", days: "nope" },
  ],
  meals: { lunch: "13:00" },
});
assert.equal(n.blocks.length, 1, "drops malformed block");
assert.equal(n.meals.lunch, "13:00", "keeps provided meal");
assert.equal(n.meals.breakfast, DEFAULT_MEALS.breakfast, "fills missing meal");
console.log("normalizeSchedule OK");

// ── Task 3: resolveDaySchedule ────────────────────────────────────────────────
import { resolveDaySchedule } from "../src/domain/schedule.js";

const sched = normalizeSchedule({
  blocks: [
    { id: "w", type: "work", label: "Work", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] },
    { id: "g", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
  ],
  wake: { source: "manual", weekday: "06:40", weekend: "09:10" },
  sleep: { source: "manual", weekday: "23:10", weekend: "23:30" },
});

const sat = resolveDaySchedule(sched, new Date("2026-06-13T12:00:00"));
assert.equal(sat.weekdayName, "Saturday");
assert.equal(sat.isWeekend, true);
assert.deepEqual(sat.commitments.map((c) => c.label), ["Gym"], "Sat: only gym");
assert.equal(sat.wake, "09:10", "Sat uses weekend wake");

const mon = resolveDaySchedule(sched, new Date("2026-06-08T12:00:00"));
assert.deepEqual(mon.commitments.map((c) => c.label), ["Work"], "Mon: only work");
assert.equal(mon.wake, "06:40", "Mon uses weekday wake");

assert.equal(resolveDaySchedule(null), null, "null -> null");
console.log("resolveDaySchedule OK");

// ── Task 4: deriveRoutineSummary ──────────────────────────────────────────────
import { deriveRoutineSummary } from "../src/domain/schedule.js";

const summary = deriveRoutineSummary(normalizeSchedule({
  blocks: [
    { id: "w", type: "work", label: "Work", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] },
    { id: "g", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
  ],
  wake: { source: "manual", weekday: "06:40" },
}));
assert.ok(summary.includes("Work 09:00-17:00 (weekdays)"), "summarizes weekdays");
assert.ok(summary.includes("Gym 18:00-19:00 (Tue/Thu/Sat)"), "summarizes day list");
assert.ok(summary.length > 5, "non-empty");
console.log("deriveRoutineSummary OK");
