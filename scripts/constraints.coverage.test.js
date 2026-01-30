import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import { RESET_LIBRARY } from "../src/domain/libraries/resets.js";
import { PROFILE_LABELS } from "../src/domain/profiles.js";
import { computeLoadCapacity } from "../src/domain/scoring.js";
import { bandCapacity } from "../src/domain/scoring/profile.js";
import { DEFAULT_PARAMETERS } from "../src/domain/params.js";

const MIN_ELIGIBLE_RESETS = Math.max(1, Number(process.env.MIN_ELIGIBLE_RESETS || 3));
const MIN_SHORT_RESETS = Math.max(1, Number(process.env.MIN_SHORT_RESETS || 2));

function buildContraSet(constraints) {
  const injuries = constraints?.injuries || {};
  const active = new Set();
  if (injuries.knee) active.add("injury:knee");
  if (injuries.shoulder) active.add("injury:shoulder");
  if (injuries.back) active.add("injury:back");
  if (injuries.neck) active.add("injury:neck");
  return active;
}

function hasConflict(item, contraSet) {
  const contraTags = Array.isArray(item?.contraTags) ? item.contraTags : [];
  return contraTags.some((tag) => contraSet.has(tag));
}

function eligibleResets(constraints, timeMin) {
  const contraSet = buildContraSet(constraints);
  const maxSec = timeMin <= 5 ? 180 : 300;
  return RESET_LIBRARY.filter(
    (item) =>
      !hasConflict(item, contraSet) &&
      Number(item.durationSec) >= 120 &&
      Number(item.durationSec) <= maxSec
  );
}

function eligibleShortResets(constraints) {
  const contraSet = buildContraSet(constraints);
  return RESET_LIBRARY.filter(
    (item) =>
      !hasConflict(item, contraSet) &&
      Number(item.durationSec) >= 120 &&
      Number(item.durationSec) <= 180
  );
}

function capacityBandFor(checkIn) {
  const scores = computeLoadCapacity(checkIn);
  return bandCapacity(scores.capacity, DEFAULT_PARAMETERS.profileThresholds);
}

async function loadScenarioPacks() {
  const dir = path.join(process.cwd(), "scripts", "scenarios");
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const scenarios = [];
  for (const name of files) {
    const raw = await fs.readFile(path.join(dir, name), "utf8");
    const parsed = JSON.parse(raw);
    scenarios.push(parsed);
  }
  return scenarios;
}

async function run() {
  const scenarios = await loadScenarioPacks();
  assert(scenarios.length > 0, "scenario packs should exist");

  const capacityChecks = [
    { band: "low", checkIn: { stress: 7, sleepQuality: 3, energy: 3, timeAvailableMin: 5 } },
    { band: "medium", checkIn: { stress: 5, sleepQuality: 6, energy: 6, timeAvailableMin: 15 } },
    { band: "high", checkIn: { stress: 3, sleepQuality: 9, energy: 9, timeAvailableMin: 45 } },
  ];

  capacityChecks.forEach(({ band, checkIn }) => {
    const resolved = capacityBandFor(checkIn);
    assert.strictEqual(resolved, band, `capacity band fixture should resolve to ${band}`);
  });

  for (const scenario of scenarios) {
    const constraints = scenario?.baseline?.constraints || scenario?.constraints || {};
    for (const profile of PROFILE_LABELS) {
      for (const { band, checkIn } of capacityChecks) {
        const pool = eligibleResets(constraints, checkIn.timeAvailableMin);
        assert(
          pool.length >= MIN_ELIGIBLE_RESETS,
          `${scenario.id} ${profile} ${band} should have >= ${MIN_ELIGIBLE_RESETS} eligible resets`
        );
      }
    }
    const shortPool = eligibleShortResets(constraints);
    assert(
      shortPool.length >= MIN_SHORT_RESETS,
      `${scenario.id} ten_minutes should have >= ${MIN_SHORT_RESETS} short resets`
    );
  }

  console.log(
    JSON.stringify({ ok: true, packs: scenarios.length, minEligibleResets: MIN_ELIGIBLE_RESETS, minShortResets: MIN_SHORT_RESETS })
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
