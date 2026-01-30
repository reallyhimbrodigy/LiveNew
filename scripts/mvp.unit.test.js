import assert from "node:assert";
import { computeLoadCapacity } from "../src/domain/scoring.js";
import { assignProfile } from "../src/domain/profiles.js";
import { buildToday } from "../src/domain/planner.js";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";
import { applyQuickSignal } from "../src/domain/swap.js";
import { getDateKey, getDateRangeKeys } from "../src/utils/dateKey.js";
import { RESET_LIBRARY } from "../src/domain/libraries/resets.js";
import { MOVEMENT_LIBRARY } from "../src/domain/libraries/movement.js";
import { NUTRITION_LIBRARY } from "../src/domain/libraries/nutrition.js";

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expectedDateKey(nowISO, timezone, dayBoundaryHour) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowISO));
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") map[part.type] = part.value;
  });
  const dateISO = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour || 0);
  if (Number.isFinite(hour) && hour < dayBoundaryHour) {
    return addDaysISO(dateISO, -1);
  }
  return dateISO;
}

function testScoringDeterminism() {
  const checkin = { stress: 5, sleepQuality: 5, energy: 5, timeMin: 10 };
  const a = computeLoadCapacity(checkin);
  const b = computeLoadCapacity(checkin);
  assert.deepStrictEqual(a, b, "computeLoadCapacity should be deterministic");
  assert(a.load >= 0 && a.load <= 100, "load should be 0..100");
  assert(a.capacity >= 0 && a.capacity <= 100, "capacity should be 0..100");
}

function testProfileAssignment() {
  const poorSleep = assignProfile({ load: 80, capacity: 30, sleep: 3, energy: 4 });
  assert.strictEqual(poorSleep, "Poor Sleep");
  const depleted = assignProfile({ load: 80, capacity: 20, sleep: 6, energy: 3 });
  assert.strictEqual(depleted, "Depleted/Burned Out");
  const wired = assignProfile({ load: 80, capacity: 60, sleep: 6, energy: 6 });
  assert.strictEqual(wired, "Wired/Overstimulated");
  const balanced = assignProfile({ load: 40, capacity: 60, sleep: 7, energy: 6 });
  assert.strictEqual(balanced, "Balanced");
}

function testPlannerDeterminism() {
  const baseline = { timezone: "America/Los_Angeles", dayBoundaryHour: 4, constraints: {} };
  const input = {
    userId: "user-1",
    dateKey: "2026-01-30",
    timezone: baseline.timezone,
    dayBoundaryHour: baseline.dayBoundaryHour,
    baseline,
    latestCheckin: { stress: 4, sleepQuality: 7, energy: 6, timeAvailableMin: 20 },
    dayState: null,
    eventsToday: [],
    panicMode: false,
    libVersion: LIB_VERSION,
  };
  const a = buildToday(input);
  const b = buildToday(input);
  assert.deepStrictEqual(a, b, "buildToday should be deterministic for same inputs");
  assert(a.meta?.inputHash, "buildToday should include inputHash");
}

function testPlannerStability() {
  const baseline = { timezone: "America/Los_Angeles", dayBoundaryHour: 4, constraints: {} };
  const input = {
    userId: "user-2",
    dateKey: "2026-01-30",
    timezone: baseline.timezone,
    dayBoundaryHour: baseline.dayBoundaryHour,
    baseline,
    latestCheckin: { stress: 5, sleepQuality: 7, energy: 6, timeAvailableMin: 20 },
    dayState: null,
    eventsToday: [],
    panicMode: false,
    libVersion: LIB_VERSION,
  };
  const first = buildToday(input);
  const dayState = {
    resetId: first.reset.id,
    movementId: first.movement?.id || null,
    nutritionId: first.nutrition.id,
    lastQuickSignal: "",
  };
  const next = buildToday({
    ...input,
    latestCheckin: { ...input.latestCheckin, stress: 6 },
    dayState,
  });
  assert.strictEqual(next.reset.id, first.reset.id, "reset should stay stable for small stress change");
  assert.strictEqual(next.movement?.id || null, first.movement?.id || null, "movement should stay stable");
  assert.strictEqual(next.nutrition.id, first.nutrition.id, "nutrition should stay stable");
}

function testPanicMode() {
  const baseline = { timezone: "America/Los_Angeles", dayBoundaryHour: 4, constraints: {} };
  const contract = buildToday({
    userId: "user-3",
    dateKey: "2026-01-30",
    timezone: baseline.timezone,
    dayBoundaryHour: baseline.dayBoundaryHour,
    baseline,
    latestCheckin: { stress: 6, sleepQuality: 4, energy: 4, timeAvailableMin: 10, safety: { panic: true } },
    dayState: null,
    eventsToday: [],
    panicMode: true,
    libVersion: LIB_VERSION,
  });
  assert.strictEqual(contract.movement, null, "panic mode should suppress movement");
  assert(contract.rationale.some((line) => line.toLowerCase().includes("safe")), "panic rationale should include disclaimer");
}

function testDateKeyUtility() {
  const now = "2026-01-30T10:00:00Z";
  const timezone = "America/Los_Angeles";
  const dayBoundaryHour = 4;
  const key = getDateKey({ now, timezone, dayBoundaryHour });
  assert(key, "getDateKey should return key");
  const expected = expectedDateKey(now, timezone, dayBoundaryHour);
  assert.strictEqual(key, expected, "getDateKey should honor boundary and timezone");
  const range = getDateRangeKeys({ timezone, dayBoundaryHour, days: 7, endNow: now });
  assert.strictEqual(range.keys.length, 7, "getDateRangeKeys should return 7 keys");
  assert.strictEqual(range.toKey, key, "range.toKey should match dateKey");
}

function testSwapBoundedness() {
  const selection = { resetId: RESET_LIBRARY[0].id, movementId: MOVEMENT_LIBRARY[0].id, nutritionId: NUTRITION_LIBRARY[0].id };
  const libraries = { resets: RESET_LIBRARY, movement: MOVEMENT_LIBRARY, nutrition: NUTRITION_LIBRARY };
  const scored = { load: 70, capacity: 40 };
  const stressed = applyQuickSignal({ signal: "stressed", todaySelection: selection, scored, profile: "Wired/Overstimulated", constraints: {}, libraries });
  assert(stressed.movementId === null || stressed.movementId === selection.movementId, "stressed should not add movement");
  const tenMin = applyQuickSignal({ signal: "ten_minutes", todaySelection: selection, scored, profile: "Balanced", constraints: {}, libraries });
  assert.strictEqual(tenMin.movementId, null, "ten_minutes should suppress movement");
}

function run() {
  testScoringDeterminism();
  testProfileAssignment();
  testPlannerDeterminism();
  testPlannerStability();
  testPanicMode();
  testDateKeyUtility();
  testSwapBoundedness();
  console.log(JSON.stringify({ ok: true }));
}

run();
