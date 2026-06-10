// ── Streak domain logic — pure, testable, no I/O ─────────────────────────────
//
// This module owns the business rules for streak state. It is intentionally
// free of AsyncStorage, Zustand, or any React dependencies so it can be
// unit-tested in plain Node.

/**
 * Resolve the streak on load, given the stored record and today's date context,
 * applying a premium "freeze" that saves exactly ONE missed day.
 *
 * Rules:
 *   - lastDate === today       → unchanged (already counted today)
 *   - lastDate === yesterday   → unchanged (streak intact, one day gap is fine)
 *   - lastDate === dayBeforeYesterday AND canFreeze
 *                              → SAVE: keep count, advance lastDate to yesterday
 *                                (so today's check-in will continue the streak),
 *                                freezeConsumed = true
 *   - otherwise (older gap or no record) → broken: { count: 0, lastDate: null }
 *
 * @param {{ count: number, lastDate: string|null }|null} record
 *   The stored streak record from AsyncStorage (or null/undefined if none).
 * @param {{ today: string, yesterday: string, dayBeforeYesterday: string, canFreeze: boolean }} ctx
 *   Date context + premium-freeze eligibility.  All dates are 'YYYY-MM-DD'.
 * @returns {{ count: number, lastDate: string|null, freezeConsumed: boolean }}
 */
export function resolveStreakOnLoad(record, { today, yesterday, dayBeforeYesterday, canFreeze }) {
  // No stored record → broken streak
  if (!record || !record.lastDate) {
    return { count: 0, lastDate: null, freezeConsumed: false };
  }

  const { count, lastDate } = record;

  // Already counted today — no change
  if (lastDate === today) {
    return { count, lastDate, freezeConsumed: false };
  }

  // Checked in yesterday — streak intact, carry forward
  if (lastDate === yesterday) {
    return { count, lastDate, freezeConsumed: false };
  }

  // Missed exactly one day — premium freeze can save it
  if (lastDate === dayBeforeYesterday && canFreeze) {
    // Advance lastDate to yesterday: now the streak looks like it was
    // maintained through yesterday, and today's check-in will add to it.
    return { count, lastDate: yesterday, freezeConsumed: true };
  }

  // Gap is too large, or freeze not available — streak broken
  return { count: 0, lastDate: null, freezeConsumed: false };
}
