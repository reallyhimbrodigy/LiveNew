// Personal-correlation "deep insights" for the Progress screen.
//
// These turn the user's own check-in + completion history into honest,
// data-derived statements in Iris's voice — the kind of thing that makes a
// user think "the app actually knows me." Premium users see the real
// correlations; free users can be shown a single blurred teaser (the client
// decides — this module just produces the data).
//
// HARD RULES (do not relax these — an honest stat is the whole point):
//   - Pure function. No I/O, no DB, no throwing. Wrapped in try/catch and
//     ALWAYS returns an array (empty on any error or insufficient data).
//   - A correlation is only emitted when BOTH sides of the comparison have
//     enough qualifying days to be meaningful (MIN_SIDE each).
//   - The math is deliberately simple and verifiable: group, average,
//     percent delta. No regressions, no p-values pretending to be science.
//
// Each correlation object:
//   { id, headline, detail, stat, sampleSize }
//     id         — stable string for the client (dedupe / styling)
//     headline   — punchy, e.g. "Mornings change your whole day"
//     detail     — full sentence with the number, Iris's voice
//     stat       — the headline number (e.g. "28%" or "Monday")
//     sampleSize — total qualifying days behind the stat (honesty signal)

// Minimum qualifying days on EACH side of a comparison. Below this the delta
// is noise, not a pattern — we stay quiet rather than lie.
const MIN_SIDE = 5;
// A delta has to clear this to be worth a headline. Tiny differences are not
// "insights," they're rounding.
const MIN_DELTA_PCT = 10; // percent
const MIN_DELTA_POINTS = 0.8; // raw stress/sleep points (0–10 scale)

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function avg(nums) {
  if (!nums || nums.length === 0) return null;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Stress lower = better. Percent reduction of `withVal` vs `withoutVal`.
function pctLower(withVal, withoutVal) {
  if (!isFiniteNum(withVal) || !isFiniteNum(withoutVal) || withoutVal <= 0) return null;
  return Math.round(((withoutVal - withVal) / withoutVal) * 100);
}

// Sleep/energy higher = better. Percent improvement of `withVal` vs `withoutVal`.
function pctHigher(withVal, withoutVal) {
  if (!isFiniteNum(withVal) || !isFiniteNum(withoutVal) || withoutVal <= 0) return null;
  return Math.round(((withVal - withoutVal) / withoutVal) * 100);
}

// Build a date_key -> true set from an event array shaped [{ date_key }].
function daysWithEvent(events) {
  const set = new Set();
  if (!Array.isArray(events)) return set;
  for (const e of events) {
    const key = e?.date_key || e?.dateKey || e?.date;
    if (typeof key === "string" && key) set.add(key);
  }
  return set;
}

// Split a metric across days that HAD vs DID NOT have an event.
// `metricOf` extracts the metric (e.g. stress) from a check-in; null skips it.
function splitByEvent(checkIns, eventDays, metricOf) {
  const withVals = [];
  const withoutVals = [];
  for (const c of checkIns) {
    const v = metricOf(c);
    if (!isFiniteNum(v)) continue;
    if (eventDays.has(c.dateKey)) withVals.push(v);
    else withoutVals.push(v);
  }
  return { withVals, withoutVals };
}

/**
 * @param {Object} input
 * @param {Array<{dateKey:string, stress:number, sleepQuality:number, energy:number}>} input.checkIns
 * @param {Array<{date_key:string}>} input.resetEvents   reset_completed + session_feedback (any active session)
 * @param {Array<{date_key:string}>} input.moveEvents    movement_completed
 * @param {Array<{date_key:string}>} input.winddownEvents winddown_completed
 * @param {number} [input.streak]                          current check-in streak (optional)
 * @returns {Array<{id,headline,detail,stat,sampleSize}>}
 */
export function computeCorrelations(input) {
  try {
    const checkIns = Array.isArray(input?.checkIns) ? input.checkIns : [];
    // Need a reasonable base of check-ins before any split can clear MIN_SIDE
    // on both sides. (Two full sides of 5 = 10 minimum.)
    if (checkIns.length < MIN_SIDE * 2) return [];

    const out = [];

    const resetDays = daysWithEvent(input?.resetEvents);
    const winddownDays = daysWithEvent(input?.winddownEvents);

    // ---- 1. Stress on days with an active session (reset/feedback) vs not ----
    // resetEvents already includes session_feedback completions (merged server
    // side), so this is "days you actually did something" — the cleanest
    // engagement lever we have.
    try {
      const { withVals, withoutVals } = splitByEvent(
        checkIns,
        resetDays,
        (c) => c.stress
      );
      if (withVals.length >= MIN_SIDE && withoutVals.length >= MIN_SIDE) {
        const a = avg(withVals);
        const b = avg(withoutVals);
        const pct = pctLower(a, b);
        if (
          isFiniteNum(pct) &&
          pct >= MIN_DELTA_PCT &&
          isFiniteNum(a) &&
          isFiniteNum(b) &&
          b - a >= MIN_DELTA_POINTS
        ) {
          out.push({
            id: "reset_stress",
            headline: "Doing the work pays off",
            detail: `Your stress runs ${pct}% lower on days you complete a reset.`,
            stat: `${pct}%`,
            sampleSize: withVals.length + withoutVals.length,
          });
        }
      }
    } catch {}

    // ---- 2. Sleep quality on days with an evening winddown vs not ----
    try {
      const { withVals, withoutVals } = splitByEvent(
        checkIns,
        winddownDays,
        (c) => c.sleepQuality
      );
      if (withVals.length >= MIN_SIDE && withoutVals.length >= MIN_SIDE) {
        const a = avg(withVals);
        const b = avg(withoutVals);
        const pct = pctHigher(a, b);
        if (
          isFiniteNum(pct) &&
          pct >= MIN_DELTA_PCT &&
          isFiniteNum(a) &&
          isFiniteNum(b) &&
          a - b >= MIN_DELTA_POINTS
        ) {
          out.push({
            id: "winddown_sleep",
            headline: "Your evenings set up your nights",
            detail: `You sleep ${pct}% better on the nights you finish your evening wind-down.`,
            stat: `${pct}%`,
            sampleSize: withVals.length + withoutVals.length,
          });
        }
      }
    } catch {}

    // ---- 3. Best vs worst day of the week for stress ----
    try {
      const buckets = {}; // dayIdx -> [stress]
      for (const c of checkIns) {
        if (!isFiniteNum(c.stress) || typeof c.dateKey !== "string") continue;
        // Noon UTC avoids any off-by-one from the date-only key.
        const d = new Date(c.dateKey + "T12:00:00Z");
        const idx = d.getUTCDay();
        if (idx < 0 || idx > 6 || Number.isNaN(idx)) continue;
        if (!buckets[idx]) buckets[idx] = [];
        buckets[idx].push(c.stress);
      }
      // Only consider days we've seen at least 3 times — one rough Tuesday
      // is not "Tuesdays are hard."
      let best = null; // { idx, avg, n }
      let worst = null;
      let qualifyingDays = 0;
      for (const idxStr of Object.keys(buckets)) {
        const arr = buckets[idxStr];
        if (!arr || arr.length < 3) continue;
        const a = avg(arr);
        if (!isFiniteNum(a)) continue;
        const idx = Number(idxStr);
        qualifyingDays += arr.length;
        if (!best || a < best.avg) best = { idx, avg: a, n: arr.length };
        if (!worst || a > worst.avg) worst = { idx, avg: a, n: arr.length };
      }
      if (best && worst && best.idx !== worst.idx) {
        const delta = worst.avg - best.avg;
        if (delta >= MIN_DELTA_POINTS) {
          out.push({
            id: "worst_weekday",
            headline: `${DAY_NAMES[worst.idx]}s hit hardest`,
            detail: `${DAY_NAMES[worst.idx]} is your most stressful day — it averages ${delta.toFixed(
              1
            )} points higher than your calmest day, ${DAY_NAMES[best.idx]}.`,
            stat: DAY_NAMES[worst.idx],
            sampleSize: qualifyingDays,
          });
        }
      }
    } catch {}

    // ---- 4. Stress trend: are recent days calmer than earlier ones? ----
    // Compares the most recent half of check-ins against the earlier half.
    // Only fires with a real history (>= 10) and a clear direction.
    try {
      const withStress = checkIns
        .filter((c) => isFiniteNum(c.stress))
        // checkIns arrive ascending by date_key; keep that order
        .map((c) => c.stress);
      if (withStress.length >= MIN_SIDE * 2) {
        const mid = Math.floor(withStress.length / 2);
        const earlier = withStress.slice(0, mid);
        const recent = withStress.slice(withStress.length - mid);
        const earlierAvg = avg(earlier);
        const recentAvg = avg(recent);
        if (isFiniteNum(earlierAvg) && isFiniteNum(recentAvg)) {
          const drop = earlierAvg - recentAvg; // positive = calmer now
          const pct = pctLower(recentAvg, earlierAvg);
          if (
            drop >= MIN_DELTA_POINTS &&
            isFiniteNum(pct) &&
            pct >= MIN_DELTA_PCT
          ) {
            out.push({
              id: "stress_trend",
              headline: "You're trending calmer",
              detail: `Your stress is down ${pct}% compared with when you started. The work is compounding.`,
              stat: `${pct}%`,
              sampleSize: withStress.length,
            });
          }
        }
      }
    } catch {}

    // Quality over quantity — surface the strongest few, most actionable first.
    // Order is already roughly best-to-show; cap at 4.
    return out.slice(0, 4);
  } catch (err) {
    // Never let an insight computation sink the progress response.
    return [];
  }
}
