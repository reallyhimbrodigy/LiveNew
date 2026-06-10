import assert from "node:assert";
import { resolveStreakOnLoad } from "../src/domain/streak.js";

// ── Shared date context ───────────────────────────────────────────────────────

const ctx = {
  today:             '2026-06-09',
  yesterday:         '2026-06-08',
  dayBeforeYesterday:'2026-06-07',
};

// ── lastDate === today: no change ─────────────────────────────────────────────

{
  const r = resolveStreakOnLoad({ count: 5, lastDate: '2026-06-09' }, { ...ctx, canFreeze: false });
  assert.strictEqual(r.count,  5,            'today: count unchanged');
  assert.strictEqual(r.lastDate, '2026-06-09', 'today: lastDate unchanged');
  assert.strictEqual(r.freezeConsumed, false, 'today: freezeConsumed false');
}

{
  // Premium user, lastDate today — still no change
  const r = resolveStreakOnLoad({ count: 10, lastDate: '2026-06-09' }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count, 10, 'today (premium): count unchanged');
  assert.strictEqual(r.freezeConsumed, false, 'today (premium): freeze not consumed');
}

// ── lastDate === yesterday: streak intact ─────────────────────────────────────

{
  const r = resolveStreakOnLoad({ count: 3, lastDate: '2026-06-08' }, { ...ctx, canFreeze: false });
  assert.strictEqual(r.count,  3,            'yesterday (free): count unchanged');
  assert.strictEqual(r.lastDate, '2026-06-08', 'yesterday (free): lastDate unchanged');
  assert.strictEqual(r.freezeConsumed, false, 'yesterday (free): freezeConsumed false');
}

{
  // Premium, checked in yesterday — freeze should NOT be consumed
  const r = resolveStreakOnLoad({ count: 7, lastDate: '2026-06-08' }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count, 7, 'yesterday (premium): count unchanged');
  assert.strictEqual(r.freezeConsumed, false, 'yesterday (premium): freeze NOT consumed when only 1 day gap');
}

// ── dayBeforeYesterday + canFreeze=true: streak SAVED ─────────────────────────

{
  const r = resolveStreakOnLoad({ count: 8, lastDate: '2026-06-07' }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count,  8,            'dbY+freeze: count kept');
  assert.strictEqual(r.lastDate, '2026-06-08', 'dbY+freeze: lastDate advanced to yesterday');
  assert.strictEqual(r.freezeConsumed, true,  'dbY+freeze: freeze consumed');
}

// ── dayBeforeYesterday + canFreeze=false: broken ──────────────────────────────

{
  const r = resolveStreakOnLoad({ count: 8, lastDate: '2026-06-07' }, { ...ctx, canFreeze: false });
  assert.strictEqual(r.count,  0,    'dbY+noFreeze: streak broken');
  assert.strictEqual(r.lastDate, null, 'dbY+noFreeze: lastDate null');
  assert.strictEqual(r.freezeConsumed, false, 'dbY+noFreeze: freeze not consumed');
}

// ── older gap (3+ days ago): always broken ────────────────────────────────────

{
  const r = resolveStreakOnLoad({ count: 15, lastDate: '2026-06-05' }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count,  0,    'oldGap+premium: streak broken');
  assert.strictEqual(r.lastDate, null, 'oldGap+premium: lastDate null');
  assert.strictEqual(r.freezeConsumed, false, 'oldGap+premium: freeze not consumed (gap too large)');
}

{
  const r = resolveStreakOnLoad({ count: 5, lastDate: '2025-01-01' }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count,  0,    'veryOldGap: streak broken');
  assert.strictEqual(r.freezeConsumed, false, 'veryOldGap: freeze not consumed');
}

// ── empty / null record: broken ───────────────────────────────────────────────

{
  const r = resolveStreakOnLoad(null, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count,   0,    'null record: count 0');
  assert.strictEqual(r.lastDate, null, 'null record: lastDate null');
  assert.strictEqual(r.freezeConsumed, false, 'null record: freezeConsumed false');
}

{
  const r = resolveStreakOnLoad(undefined, { ...ctx, canFreeze: false });
  assert.strictEqual(r.count, 0, 'undefined record: count 0');
}

{
  // Record with null lastDate
  const r = resolveStreakOnLoad({ count: 5, lastDate: null }, { ...ctx, canFreeze: true });
  assert.strictEqual(r.count, 0, 'null lastDate: count 0');
  assert.strictEqual(r.freezeConsumed, false, 'null lastDate: freeze not consumed');
}

console.log("streak OK");
