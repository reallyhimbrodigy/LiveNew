import assert from "node:assert";
import { DAILY_QUOTES, quoteForDay, quoteById } from "../src/domain/dailyQuotes.js";

// ── DAILY_QUOTES array shape ──────────────────────────────────────────────────

assert(Array.isArray(DAILY_QUOTES), "DAILY_QUOTES should be an array");
assert(DAILY_QUOTES.length >= 16, `DAILY_QUOTES should have at least 16 entries, got ${DAILY_QUOTES.length}`);

for (let i = 0; i < DAILY_QUOTES.length; i++) {
  const q = DAILY_QUOTES[i];
  assert(typeof q.id === "string" && q.id.length > 0,     `quote[${i}].id must be a non-empty string`);
  assert(typeof q.text === "string" && q.text.length > 0, `quote[${i}].text must be a non-empty string`);
  assert(typeof q.author === "string" && q.author.length > 0, `quote[${i}].author must be a non-empty string`);
}

// ── IDs must be unique ────────────────────────────────────────────────────────

const ids = DAILY_QUOTES.map((q) => q.id);
const uniqueIds = new Set(ids);
assert.strictEqual(uniqueIds.size, ids.length, "All quote ids must be unique");

// ── quoteForDay ───────────────────────────────────────────────────────────────

// Returns a valid quote object.
const today = new Date();
const q = quoteForDay(today);
assert(q && typeof q.id === "string",     "quoteForDay should return a quote with an id");
assert(typeof q.text === "string",         "quoteForDay should return a quote with text");
assert(typeof q.author === "string",       "quoteForDay should return a quote with an author");

// Same date → same quote (day-stable).
const date1 = new Date("2025-03-15T08:00:00Z");
const date2 = new Date("2025-03-15T23:59:59Z");
assert.deepStrictEqual(
  quoteForDay(date1),
  quoteForDay(date2),
  "quoteForDay should return the same quote for any time within the same UTC day"
);

// Different UTC days can return different quotes (optional — just test the
// function doesn't crash and always returns a valid DAILY_QUOTES entry).
const refIds = new Set(DAILY_QUOTES.map((q) => q.id));
for (let d = 0; d < DAILY_QUOTES.length * 2; d++) {
  const date = new Date(Date.UTC(2025, 0, 1 + d));
  const result = quoteForDay(date);
  assert(refIds.has(result.id), `quoteForDay for day +${d} returned an id not in DAILY_QUOTES: ${result.id}`);
}

// ── quoteById ────────────────────────────────────────────────────────────────

assert.strictEqual(quoteById("ali_will")?.text.includes("count the days"), true, "quoteById('ali_will') should find the Ali quote");
assert.strictEqual(quoteById("nonexistent_id"), undefined, "quoteById with unknown id should return undefined");

// Every id in DAILY_QUOTES resolves via quoteById.
for (const quote of DAILY_QUOTES) {
  const found = quoteById(quote.id);
  assert.strictEqual(found, quote, `quoteById('${quote.id}') should return the matching quote object`);
}

console.log("quotes OK");
