import assert from "node:assert";
import {
  RECOMMENDATIONS,
  recById,
  recForToday,
} from "../src/domain/recommendations.js";

// ── RECOMMENDATIONS array shape ───────────────────────────────────────────────

assert(Array.isArray(RECOMMENDATIONS), "RECOMMENDATIONS should be an array");
assert(RECOMMENDATIONS.length >= 12, `RECOMMENDATIONS should have at least 12 entries, got ${RECOMMENDATIONS.length}`);

// Every entry has required fields
for (const r of RECOMMENDATIONS) {
  assert(typeof r.id === "string" && r.id.length > 0, `rec ${JSON.stringify(r)} missing id`);
  assert(typeof r.title === "string" && r.title.length > 0, `rec ${r.id} missing title`);
  assert(typeof r.why === "string" && r.why.length > 0, `rec ${r.id} missing why`);
  assert(
    ["morning", "day", "evening", "any"].includes(r.timeOfDay),
    `rec ${r.id} has invalid timeOfDay: ${r.timeOfDay}`
  );
}

// IDs are unique
const ids = RECOMMENDATIONS.map((r) => r.id);
const uniqueIds = new Set(ids);
assert.strictEqual(uniqueIds.size, ids.length, "All recommendation IDs must be unique");

// ── recById ───────────────────────────────────────────────────────────────────

const morningRec = recById("morning_sun");
assert(morningRec !== undefined, "recById('morning_sun') should return a rec");
assert.strictEqual(morningRec.timeOfDay, "morning", "morning_sun should be timeOfDay 'morning'");

assert.strictEqual(recById("nope_does_not_exist"), undefined, "recById unknown id should return undefined");

const breathRec = recById("breathwork");
assert(breathRec !== undefined, "recById('breathwork') should return a rec");
assert.strictEqual(breathRec.timeOfDay, "any", "breathwork should be timeOfDay 'any'");

// ── recForToday ───────────────────────────────────────────────────────────────

// Morning date (7am)
const morningDate = new Date("2025-06-10T07:00:00");
const morningResult = recForToday(morningDate);
assert(morningResult !== undefined, "recForToday(morning) should return a rec");
assert(typeof morningResult.id === "string", "recForToday(morning) result should have an id");
assert(
  ["morning", "any"].includes(morningResult.timeOfDay),
  `recForToday(morning) should return a morning or any rec, got: ${morningResult.timeOfDay}`
);

// Evening date (8pm)
const eveningDate = new Date("2025-06-10T20:00:00");
const eveningResult = recForToday(eveningDate);
assert(eveningResult !== undefined, "recForToday(evening) should return a rec");
assert(typeof eveningResult.id === "string", "recForToday(evening) result should have an id");
assert(
  ["evening", "any"].includes(eveningResult.timeOfDay),
  `recForToday(evening) should return an evening or any rec, got: ${eveningResult.timeOfDay}`
);

// Day date (2pm)
const dayDate = new Date("2025-06-10T14:00:00");
const dayResult = recForToday(dayDate);
assert(dayResult !== undefined, "recForToday(day) should return a rec");
assert(
  ["day", "any"].includes(dayResult.timeOfDay),
  `recForToday(day) should return a day or any rec, got: ${dayResult.timeOfDay}`
);

// Day-stability: same date always returns the same rec
const sameDay1 = recForToday(new Date("2025-06-10T09:00:00"));
const sameDay2 = recForToday(new Date("2025-06-10T09:30:00"));
assert.strictEqual(sameDay1.id, sameDay2.id, "recForToday should be stable within the same day and time bucket");

// Default (no arg) does not throw
const defaultResult = recForToday();
assert(defaultResult !== undefined, "recForToday() with no args should return a rec");
assert(typeof defaultResult.id === "string", "recForToday() default result should have an id");

console.log("recs OK");
