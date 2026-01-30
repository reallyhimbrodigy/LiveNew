import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { computeLoadCapacity } from "../src/domain/scoring.js";
import { assignProfile } from "../src/domain/profiles.js";
import { buildToday } from "../src/domain/planner.js";
import { LIB_VERSION } from "../src/domain/libraryVersion.js";
import { applyQuickSignal } from "../src/domain/swap.js";
import { getDateKey, getDateRangeKeys } from "../src/utils/dateKey.js";
import { RESET_LIBRARY } from "../src/domain/libraries/resets.js";
import { MOVEMENT_LIBRARY } from "../src/domain/libraries/movement.js";
import { NUTRITION_LIBRARY } from "../src/domain/libraries/nutrition.js";
import { PROFILE_LABELS } from "../src/domain/profiles.js";
import { createParityCounters } from "../src/server/parityCounters.js";
import { hashContent } from "../src/server/lockChecks.js";
import { compareOutcomes } from "./maintenance-verify.js";

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

function testPlannerRepeatSameDay() {
  const baseline = { timezone: "America/Los_Angeles", dayBoundaryHour: 4, constraints: {} };
  const input = {
    userId: "user-2b",
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
  const repeat = buildToday({ ...input, dayState });
  assert.strictEqual(repeat.reset.id, first.reset.id, "repeat checkin should not reshuffle reset");
  assert.strictEqual(repeat.movement?.id || null, first.movement?.id || null, "repeat checkin should not reshuffle movement");
  assert.strictEqual(repeat.nutrition.id, first.nutrition.id, "repeat checkin should not reshuffle nutrition");
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
    dayState: { movementId: MOVEMENT_LIBRARY[0].id },
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

function testDateKeyBoundaryRollover() {
  const timezone = "America/Los_Angeles";
  const dayBoundaryHour = 4;
  const beforeBoundary = "2026-01-30T10:59:00Z";
  const afterBoundary = "2026-01-30T13:30:00Z";
  const keyBefore = getDateKey({ now: beforeBoundary, timezone, dayBoundaryHour });
  const keyAfter = getDateKey({ now: afterBoundary, timezone, dayBoundaryHour });
  assert(keyBefore < keyAfter, "dateKey should roll over after boundary");
}

function testSwapBoundedness() {
  const selection = { resetId: RESET_LIBRARY[0].id, movementId: MOVEMENT_LIBRARY[0].id, nutritionId: NUTRITION_LIBRARY[0].id };
  const libraries = { resets: RESET_LIBRARY, movement: MOVEMENT_LIBRARY, nutrition: NUTRITION_LIBRARY };
  const scored = { load: 70, capacity: 40 };
  const signals = ["stressed", "exhausted", "ten_minutes"];
  signals.forEach((signal) => {
    const next = applyQuickSignal({ signal, todaySelection: selection, scored, profile: "Wired/Overstimulated", constraints: {}, libraries });
    const currentReset = RESET_LIBRARY.find((item) => item.id === selection.resetId);
    const nextReset = RESET_LIBRARY.find((item) => item.id === next.resetId);
    if (currentReset && nextReset && currentReset.id !== nextReset.id) {
      assert(nextReset.durationSec <= currentReset.durationSec, `${signal} should not increase reset demand`);
    }
    assert(next.movementId === null || next.movementId === selection.movementId, `${signal} should not increase movement`);
  });
  const lowCapacity = applyQuickSignal({ signal: "more_energy", todaySelection: selection, scored: { load: 30, capacity: 40 }, profile: "Balanced", constraints: {}, libraries });
  assert.strictEqual(lowCapacity.movementId, selection.movementId, "more_energy should not add movement when capacity low");
  const tenMin = applyQuickSignal({ signal: "ten_minutes", todaySelection: selection, scored, profile: "Balanced", constraints: {}, libraries });
  assert.strictEqual(tenMin.movementId, null, "ten_minutes should suppress movement");
  const repeated = applyQuickSignal({ signal: "ten_minutes", todaySelection: tenMin, scored, profile: "Balanced", constraints: {}, libraries });
  assert.deepStrictEqual(repeated, tenMin, "repeat signal should not thrash selection");
}

function testScoringProfileResilience() {
  for (let stress = 1; stress <= 5; stress += 1) {
    for (let sleep = 1; sleep <= 5; sleep += 1) {
      for (let energy = 1; energy <= 5; energy += 1) {
        const scores = computeLoadCapacity({ stress, sleepQuality: sleep, energy, timeMin: 10 });
        assert(scores.load >= 0 && scores.load <= 100, "load should be 0..100");
        assert(scores.capacity >= 0 && scores.capacity <= 100, "capacity should be 0..100");
        const profile = assignProfile({ load: scores.load, capacity: scores.capacity, sleep, energy });
        assert(PROFILE_LABELS.includes(profile), "profile should be valid label");
      }
    }
  }
  const near = assignProfile({ load: 69, capacity: 41, sleep: 5, energy: 5, priorProfile: "Wired/Overstimulated" });
  assert.strictEqual(near, "Wired/Overstimulated", "priorProfile should hold near threshold");
}

function testLibraryLint() {
  const banned = ["cure", "treat", "diagnose", "heal", "medicate", "prescribe"];
  const checkStrings = (items, fields) => {
    items.forEach((item) => {
      fields.forEach((field) => {
        const value = item[field];
        if (!value) return;
        const text = Array.isArray(value) ? value.join(" ") : String(value);
        banned.forEach((word) => {
          assert(!text.toLowerCase().includes(word), `banned word '${word}' found`);
        });
      });
    });
  };
  const ensureTags = (items) => {
    items.forEach((item) => {
      if (item.tags) {
        assert(Array.isArray(item.tags), "tags must be array");
        item.tags.forEach((tag) => assert(typeof tag === "string", "tags must be strings"));
      }
      if (item.contraTags) {
        assert(Array.isArray(item.contraTags), "contraTags must be array");
        item.contraTags.forEach((tag) => assert(typeof tag === "string", "contraTags must be strings"));
      }
    });
  };
  const ids = (items) => items.map((item) => item.id);
  const unique = (list) => new Set(list).size === list.length;
  assert(unique(ids(RESET_LIBRARY)), "reset ids must be unique");
  assert(unique(ids(MOVEMENT_LIBRARY)), "movement ids must be unique");
  assert(unique(ids(NUTRITION_LIBRARY)), "nutrition ids must be unique");
  RESET_LIBRARY.forEach((item) => {
    assert(item.id && item.title, "reset must include id and title");
    assert(item.durationSec >= 120 && item.durationSec <= 300, "reset duration within bounds");
  });
  MOVEMENT_LIBRARY.forEach((item) => {
    assert(item.id && item.title, "movement must include id and title");
    assert(Number(item.durationMin) > 0, "movement durationMin must be positive");
  });
  NUTRITION_LIBRARY.forEach((item) => {
    assert(item.id && item.title, "nutrition must include id and title");
    assert(Array.isArray(item.bullets), "nutrition bullets must be array");
  });
  ensureTags(RESET_LIBRARY);
  ensureTags(MOVEMENT_LIBRARY);
  ensureTags(NUTRITION_LIBRARY);
  checkStrings(RESET_LIBRARY, ["title", "steps"]);
  checkStrings(MOVEMENT_LIBRARY, ["title"]);
  checkStrings(NUTRITION_LIBRARY, ["title", "bullets"]);
}

function testParityCounters() {
  const logs = [];
  const counters = createParityCounters({ logEveryCount: 2, logIntervalMs: 0, logFn: (entry) => logs.push(entry) });
  counters.recordCheckin(true);
  counters.recordCheckin(false);
  counters.recordQuick(true);
  counters.recordTodayRequest(true);
  counters.recordTodayNotModified();
  const snapshot = counters.snapshot();
  assert.strictEqual(snapshot.checkin.total, 2, "parity checkin total should track");
  assert.strictEqual(snapshot.checkin.withKey, 1, "parity checkin withKey should track");
  assert.strictEqual(snapshot.quick.total, 1, "parity quick total should track");
  assert.strictEqual(snapshot.today.total, 1, "parity today total should track");
  assert.strictEqual(snapshot.today.notModified, 1, "parity today 304 should track");
  assert(logs.length >= 1, "parity counters should emit summary logs");
}

function testHashContent() {
  const hash = hashContent("hello");
  assert.strictEqual(
    hash,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "hashContent should match sha256"
  );
}

function testCompareOutcomes() {
  const before = { range: { days: 7 }, metrics: { railOpenedDays: 1 } };
  const after = { range: { days: 7 }, metrics: { railOpenedDays: 1 } };
  const drift = { range: { days: 7 }, metrics: { railOpenedDays: 2 } };
  assert(compareOutcomes(before, after), "compareOutcomes should detect equality");
  assert(!compareOutcomes(before, drift), "compareOutcomes should detect differences");
}

function testLaunchGateDryRun() {
  const res = spawnSync(process.execPath, ["scripts/launch-gate.js"], {
    cwd: process.cwd(),
    env: { ...process.env, LAUNCH_GATE_DRY_RUN: "true" },
    encoding: "utf8",
  });
  assert.strictEqual(res.status, 0, "launch-gate dry run should exit 0");
}

function run() {
  testScoringDeterminism();
  testProfileAssignment();
  testScoringProfileResilience();
  testPlannerDeterminism();
  testPlannerStability();
  testPlannerRepeatSameDay();
  testPanicMode();
  testDateKeyUtility();
  testDateKeyBoundaryRollover();
  testSwapBoundedness();
  testLibraryLint();
  testParityCounters();
  testHashContent();
  testCompareOutcomes();
  testLaunchGateDryRun();
  console.log(JSON.stringify({ ok: true }));
}

run();
