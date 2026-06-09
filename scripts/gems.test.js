import assert from "node:assert";
import {
  GEMS,
  earnedGems,
  lockedGems,
  nextGem,
  isEarned,
  gemById,
  gemProgress,
  tierColor,
  rarityPctFor,
  formatRarity,
  standing,
} from "../src/domain/gems.js";

// ── GEMS array shape ──────────────────────────────────────────────────────────

assert(Array.isArray(GEMS), "GEMS should be an array");
assert.strictEqual(GEMS.length, 8, "GEMS should have 8 entries");

// strictly increasing day
for (let i = 1; i < GEMS.length; i++) {
  assert(
    GEMS[i].day > GEMS[i - 1].day,
    `GEMS day must be strictly increasing: index ${i}`
  );
}

// strictly decreasing rarityPct
for (let i = 1; i < GEMS.length; i++) {
  assert(
    GEMS[i].rarityPct < GEMS[i - 1].rarityPct,
    `GEMS rarityPct must be strictly decreasing: index ${i}`
  );
}

// ── earnedGems ────────────────────────────────────────────────────────────────

assert.deepStrictEqual(earnedGems(0), [], "earnedGems(0) should be []");
assert.deepStrictEqual(earnedGems(-5), [], "earnedGems(-5) should be []");
assert.deepStrictEqual(earnedGems("foo"), [], "earnedGems('foo') should be []");
assert.deepStrictEqual(earnedGems(null), [], "earnedGems(null) should be []");

const earned1 = earnedGems(1);
assert.strictEqual(earned1.length, 1, "earnedGems(1) should have 1 gem");
assert.strictEqual(earned1[0].id, "first_light", "earnedGems(1) should contain first_light");

const earned7 = earnedGems(7);
assert.deepStrictEqual(
  earned7.map((g) => g.id),
  ["first_light", "foundation", "the_week"],
  "earnedGems(7) should contain first_light, foundation, the_week"
);

const earnedAll = earnedGems(1000);
assert.strictEqual(earnedAll.length, 8, "earnedGems(1000) should return all 8 gems");

// ── lockedGems ────────────────────────────────────────────────────────────────

const locked7 = lockedGems(7);
assert.strictEqual(locked7[0].id, "rhythm", "lockedGems(7) should start with rhythm");
assert.strictEqual(
  locked7.length,
  GEMS.length - 3,
  "lockedGems(7) should have 5 entries"
);

assert.deepStrictEqual(lockedGems(1000), [], "lockedGems(1000) should be []");

// ── nextGem ───────────────────────────────────────────────────────────────────

assert.strictEqual(nextGem(7).id, "rhythm", "nextGem(7) should be rhythm");
assert.strictEqual(nextGem(0).id, "first_light", "nextGem(0) should be first_light");
assert.strictEqual(nextGem(1000), null, "nextGem(1000) should be null");

// ── isEarned ──────────────────────────────────────────────────────────────────

assert.strictEqual(isEarned("foundation", 3), true, "foundation should be earned at streak 3");
assert.strictEqual(isEarned("foundation", 2), false, "foundation should not be earned at streak 2");
assert.strictEqual(isEarned("rhythm", 3), false, "rhythm should not be earned at streak 3");
assert.strictEqual(isEarned("the_year", 365), true, "the_year should be earned at streak 365");
assert.strictEqual(isEarned("nope", 100), false, "unknown gem id should return false");

// ── gemById ───────────────────────────────────────────────────────────────────

assert.strictEqual(gemById("century").day, 100, "gemById('century').day should be 100");
assert.strictEqual(gemById("nope"), undefined, "gemById('nope') should be undefined");
assert.strictEqual(gemById("first_light").tier, "Common", "first_light tier should be Common");

// ── gemProgress ───────────────────────────────────────────────────────────────

// gemProgress(5, 3): next=the_week(day=7), prevDay=3, daysToGo=2, fraction=(5-3)/(7-3)=0.5
{
  const p = gemProgress(5, 3);
  assert.strictEqual(p.next.id, "the_week", "gemProgress(5,3).next.id should be the_week");
  assert.strictEqual(p.prevDay, 3, "gemProgress(5,3).prevDay should be 3");
  assert.strictEqual(p.daysToGo, 2, "gemProgress(5,3).daysToGo should be 2");
  assert(
    Math.abs(p.fraction - 0.5) < 0.0001,
    `gemProgress(5,3).fraction should be ~0.5, got ${p.fraction}`
  );
}

// gemProgress(7, 7): next=rhythm(day=14), prevDay=7, fraction=0
{
  const p = gemProgress(7, 7);
  assert.strictEqual(p.next.id, "rhythm", "gemProgress(7,7).next.id should be rhythm");
  assert.strictEqual(p.prevDay, 7, "gemProgress(7,7).prevDay should be 7");
  assert(
    Math.abs(p.fraction - 0) < 0.0001,
    `gemProgress(7,7).fraction should be ~0, got ${p.fraction}`
  );
}

// gemProgress(400, 365): next=null, fraction=1, daysToGo=0
{
  const p = gemProgress(400, 365);
  assert.strictEqual(p.next, null, "gemProgress(400,365).next should be null");
  assert.strictEqual(p.fraction, 1, "gemProgress(400,365).fraction should be 1");
  assert.strictEqual(p.daysToGo, 0, "gemProgress(400,365).daysToGo should be 0");
}

// gemProgress(0, 0): next=first_light, prevDay=0
{
  const p = gemProgress(0, 0);
  assert.strictEqual(p.next.id, "first_light", "gemProgress(0,0).next.id should be first_light");
  assert.strictEqual(p.prevDay, 0, "gemProgress(0,0).prevDay should be 0");
}

// ── tierColor ─────────────────────────────────────────────────────────────────

const knownTiers = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
for (const tier of knownTiers) {
  const color = tierColor(tier);
  assert(
    typeof color === "string" && color.startsWith("#"),
    `tierColor(${tier}) should return a hex color string`
  );
}
assert.strictEqual(tierColor("Unknown"), "#c4a86c", "unknown tier should return fallback color");

// ── rarityPctFor ──────────────────────────────────────────────────────────────

assert.strictEqual(
  rarityPctFor({ day: 7, rarityPct: 33 }, { 7: 25 }),
  25,
  "rarityPctFor should return live stat when present"
);
assert.strictEqual(
  rarityPctFor({ day: 7, rarityPct: 33 }, null),
  33,
  "rarityPctFor should fall back to gem.rarityPct when liveStats is null"
);
assert.strictEqual(
  rarityPctFor({ day: 7, rarityPct: 33 }, {}),
  33,
  "rarityPctFor should fall back to gem.rarityPct when day key is missing"
);
assert.strictEqual(
  rarityPctFor({ day: 7, rarityPct: 33 }, { 7: NaN }),
  33,
  "rarityPctFor should fall back when live value is NaN"
);

// ── formatRarity ──────────────────────────────────────────────────────────────

assert.strictEqual(formatRarity(0.8), "0.8", "formatRarity(0.8) should be '0.8'");
assert.strictEqual(formatRarity(33), "33", "formatRarity(33) should be '33'");
assert.strictEqual(formatRarity(0.15), "0.1", "formatRarity(0.15) should be '0.1' (toFixed(1) rounds down due to float repr)");
assert.strictEqual(formatRarity(76), "76", "formatRarity(76) should be '76'");

// ── standing ──────────────────────────────────────────────────────────────────

assert.strictEqual(standing(0, null), null, "standing(0, null) should be null");
assert.strictEqual(standing(-1, null), null, "standing(-1, null) should be null");
assert.strictEqual(standing("foo", null), null, "standing('foo', null) should be null");

{
  const st = standing(7, null);
  assert.strictEqual(st.gem.id, "the_week", "standing(7, null).gem.id should be 'the_week'");
  assert.strictEqual(st.pct, 33, "standing(7, null).pct should be 33 (designed fallback)");
}

{
  const st = standing(7, { 7: 25 });
  assert.strictEqual(st.pct, 25, "standing(7, {7:25}).pct should be 25 (live stat)");
}

{
  // maxStreak=30 → highest earned is the_month (day=30, rarityPct=7)
  const st = standing(30, null);
  assert.strictEqual(st.gem.id, "the_month", "standing(30, null).gem.id should be 'the_month'");
  assert.strictEqual(st.pct, 7, "standing(30, null).pct should be 7");
}

console.log("gems OK");
