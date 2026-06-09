import assert from "node:assert";
import {
  CORTISOL_FACTS,
  factById,
  factForIndex,
} from "../src/domain/cortisolFacts.js";

// ── Array shape ───────────────────────────────────────────────────────────────

assert(Array.isArray(CORTISOL_FACTS), "CORTISOL_FACTS should be an array");
assert(CORTISOL_FACTS.length > 0, "CORTISOL_FACTS should be non-empty");

// Each entry must have id, hook, and detail as non-empty strings
for (const fact of CORTISOL_FACTS) {
  assert(
    typeof fact.id === "string" && fact.id.length > 0,
    `Fact missing valid id: ${JSON.stringify(fact)}`
  );
  assert(
    typeof fact.hook === "string" && fact.hook.length > 0,
    `Fact missing valid hook: ${fact.id}`
  );
  assert(
    typeof fact.detail === "string" && fact.detail.length > 0,
    `Fact missing valid detail: ${fact.id}`
  );
}

// ── Unique ids ────────────────────────────────────────────────────────────────

const ids = CORTISOL_FACTS.map((f) => f.id);
const uniqueIds = new Set(ids);
assert.strictEqual(
  uniqueIds.size,
  ids.length,
  "All fact ids must be unique"
);

// ── factById ──────────────────────────────────────────────────────────────────

assert.strictEqual(
  factById("acne")?.id,
  "acne",
  "factById('acne') should return the acne fact"
);
assert.strictEqual(
  factById("sleep")?.tag,
  "sleep",
  "factById('sleep') should return a fact with tag 'sleep'"
);
assert.strictEqual(
  factById("nonexistent"),
  undefined,
  "factById('nonexistent') should return undefined"
);

// ── factForIndex — normal range ───────────────────────────────────────────────

const L = CORTISOL_FACTS.length;

assert.strictEqual(
  factForIndex(0),
  CORTISOL_FACTS[0],
  "factForIndex(0) should return the first fact"
);
assert.strictEqual(
  factForIndex(L - 1),
  CORTISOL_FACTS[L - 1],
  "factForIndex(L-1) should return the last fact"
);

// ── factForIndex — overflow wraps ─────────────────────────────────────────────

assert.strictEqual(
  factForIndex(L),
  CORTISOL_FACTS[0],
  "factForIndex(L) should wrap to CORTISOL_FACTS[0]"
);
assert.strictEqual(
  factForIndex(L + 1),
  CORTISOL_FACTS[1],
  "factForIndex(L+1) should wrap to CORTISOL_FACTS[1]"
);
assert.strictEqual(
  factForIndex(L * 5 + 3),
  CORTISOL_FACTS[3],
  "factForIndex(L*5+3) should wrap to CORTISOL_FACTS[3]"
);

// ── factForIndex — negative wraps ─────────────────────────────────────────────

assert.strictEqual(
  factForIndex(-1),
  CORTISOL_FACTS[L - 1],
  "factForIndex(-1) should wrap to the last fact"
);
assert.strictEqual(
  factForIndex(-L),
  CORTISOL_FACTS[0],
  "factForIndex(-L) should wrap to CORTISOL_FACTS[0]"
);
assert.strictEqual(
  factForIndex(-(L + 2)),
  CORTISOL_FACTS[L - 2],
  "factForIndex(-(L+2)) should wrap correctly"
);

console.log("facts OK");
