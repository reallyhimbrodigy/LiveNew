import assert from 'node:assert';
import {
  AURAS,
  auraById,
  earnedAuras,
  isAuraEarned,
} from '../src/domain/auras.js';

// ── AURAS array shape ─────────────────────────────────────────────────────────

assert(Array.isArray(AURAS), 'AURAS should be an array');
assert(AURAS.length > 0, 'AURAS should not be empty');

// Required fields on every aura
for (const a of AURAS) {
  assert(typeof a.id === 'string' && a.id.length > 0, `aura.id must be a non-empty string: ${JSON.stringify(a)}`);
  assert(typeof a.name === 'string' && a.name.length > 0, `aura.name must be a non-empty string: ${a.id}`);
  assert(typeof a.condition === 'string', `aura.condition must be a string: ${a.id}`);
  assert(typeof a.description === 'string', `aura.description must be a string: ${a.id}`);
  assert(Array.isArray(a.palette) && a.palette.length >= 4, `aura.palette must have >= 4 colors: ${a.id}`);
  for (const c of a.palette) {
    assert(typeof c === 'string' && c.startsWith('#'), `palette color must be a hex string: ${c} on ${a.id}`);
  }
  assert(typeof a.unlock === 'function', `aura.unlock must be a function: ${a.id}`);
}

// IDs must be unique
const ids = AURAS.map((a) => a.id);
const uniqueIds = new Set(ids);
assert.strictEqual(uniqueIds.size, ids.length, 'AURAS ids must be unique');

// ── Premium gate — free user can NEVER earn any aura ─────────────────────────

const freeCtx = { isPremium: false, maxStreak: 9999, allHalosEarned: true };
const freeEarned = earnedAuras(freeCtx);
assert.deepStrictEqual(freeEarned, [], 'earnedAuras with isPremium=false must return [] regardless of streak/halos');

// Each aura individually locked when isPremium=false
for (const a of AURAS) {
  assert.strictEqual(
    isAuraEarned(a.id, freeCtx),
    false,
    `isAuraEarned(${a.id}) must be false when isPremium=false`
  );
}

// ── initiate — earned when isPremium=true ─────────────────────────────────────

const premiumCtx = { isPremium: true, maxStreak: 0, allHalosEarned: false };
assert.strictEqual(isAuraEarned('initiate', premiumCtx), true, 'initiate must be earned when isPremium=true');

// initiate not earned when isPremium=false (extra guard)
assert.strictEqual(isAuraEarned('initiate', freeCtx), false, 'initiate must NOT be earned when isPremium=false');

// ── devoted — needs streak >= 14 ──────────────────────────────────────────────

assert.strictEqual(
  isAuraEarned('devoted', { isPremium: true, maxStreak: 13, allHalosEarned: false }),
  false,
  'devoted must NOT be earned at streak 13'
);
assert.strictEqual(
  isAuraEarned('devoted', { isPremium: true, maxStreak: 14, allHalosEarned: false }),
  true,
  'devoted must be earned at streak 14'
);
assert.strictEqual(
  isAuraEarned('devoted', { isPremium: false, maxStreak: 14, allHalosEarned: false }),
  false,
  'devoted must NOT be earned when isPremium=false even at streak 14'
);

// ── ascendant — needs streak >= 30 ───────────────────────────────────────────

assert.strictEqual(
  isAuraEarned('ascendant', { isPremium: true, maxStreak: 29, allHalosEarned: false }),
  false,
  'ascendant must NOT be earned at streak 29'
);
assert.strictEqual(
  isAuraEarned('ascendant', { isPremium: true, maxStreak: 30, allHalosEarned: false }),
  true,
  'ascendant must be earned at streak 30'
);

// ── eternal — needs streak >= 100 ────────────────────────────────────────────

assert.strictEqual(
  isAuraEarned('eternal', { isPremium: true, maxStreak: 99, allHalosEarned: false }),
  false,
  'eternal must NOT be earned at streak 99'
);
assert.strictEqual(
  isAuraEarned('eternal', { isPremium: true, maxStreak: 100, allHalosEarned: false }),
  true,
  'eternal must be earned at streak 100'
);

// ── paragon — needs isPremium + allHalosEarned ────────────────────────────────

assert.strictEqual(
  isAuraEarned('paragon', { isPremium: true, maxStreak: 365, allHalosEarned: false }),
  false,
  'paragon must NOT be earned when allHalosEarned=false'
);
assert.strictEqual(
  isAuraEarned('paragon', { isPremium: true, maxStreak: 365, allHalosEarned: true }),
  true,
  'paragon must be earned when isPremium=true + allHalosEarned=true'
);
assert.strictEqual(
  isAuraEarned('paragon', { isPremium: false, maxStreak: 365, allHalosEarned: true }),
  false,
  'paragon must NOT be earned when isPremium=false even if allHalosEarned=true'
);

// ── earnedAuras — multiple at once ───────────────────────────────────────────

const highCtx = { isPremium: true, maxStreak: 100, allHalosEarned: false };
const highEarned = earnedAuras(highCtx);
// Should include initiate, devoted, ascendant, eternal; NOT paragon (allHalosEarned=false)
assert(highEarned.some((a) => a.id === 'initiate'), 'highCtx should earn initiate');
assert(highEarned.some((a) => a.id === 'devoted'), 'highCtx should earn devoted');
assert(highEarned.some((a) => a.id === 'ascendant'), 'highCtx should earn ascendant');
assert(highEarned.some((a) => a.id === 'eternal'), 'highCtx should earn eternal');
assert(!highEarned.some((a) => a.id === 'paragon'), 'highCtx should NOT earn paragon (allHalosEarned=false)');

// ── auraById ──────────────────────────────────────────────────────────────────

assert.strictEqual(auraById('initiate').name, "Initiate's Aura", "auraById('initiate').name should match");
assert.strictEqual(auraById('nope'), undefined, "auraById('nope') should return undefined");

// ── isAuraEarned — unknown id ─────────────────────────────────────────────────

assert.strictEqual(
  isAuraEarned('nope', { isPremium: true, maxStreak: 999, allHalosEarned: true }),
  false,
  'isAuraEarned with unknown id must return false'
);

console.log('auras OK');
