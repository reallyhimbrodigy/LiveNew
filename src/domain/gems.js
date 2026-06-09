// ── Gem definitions ───────────────────────────────────────────────────────────

export const GEMS = [
  { id: 'first_light', name: 'First Light', day: 1,   tier: 'Common',    rarityPct: 76,   hue: '#d8c089', flavor: 'You showed up. The count begins.' },
  { id: 'foundation',  name: 'Foundation',  day: 3,   tier: 'Common',    rarityPct: 50,   hue: '#cdac68', flavor: 'Three days in — Iris has your baseline.' },
  { id: 'the_week',    name: 'The Week',    day: 7,   tier: 'Uncommon',  rarityPct: 33,   hue: '#c4a86c', flavor: 'A full week. The hardest one is behind you.' },
  { id: 'rhythm',      name: 'Rhythm',      day: 14,  tier: 'Rare',      rarityPct: 18,   hue: '#c79a4e', flavor: 'Two weeks. The pattern is real now.' },
  { id: 'the_month',   name: 'The Month',   day: 30,  tier: 'Epic',      rarityPct: 7,    hue: '#c98f3a', flavor: 'Thirty days. This is who you are now.' },
  { id: 'steadfast',   name: 'Steadfast',   day: 60,  tier: 'Epic',      rarityPct: 2.5,  hue: '#cf8a2e', flavor: 'Sixty days of showing up. Unshakable.' },
  { id: 'century',     name: 'Century',     day: 100, tier: 'Legendary', rarityPct: 0.8,  hue: '#e0a93f', flavor: 'One hundred days. Few ever see this.' },
  { id: 'the_year',    name: 'The Year',    day: 365, tier: 'Mythic',    rarityPct: 0.15, hue: '#f0c44a', flavor: 'A full year. Legendary, literally.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when maxStreak is a number >= 1. */
function validStreak(maxStreak) {
  return typeof maxStreak === 'number' && Number.isFinite(maxStreak) && maxStreak >= 1;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Gems whose day threshold has been reached (day <= maxStreak), in order.
 * maxStreak < 1 or non-number → [].
 */
export function earnedGems(maxStreak) {
  if (!validStreak(maxStreak)) return [];
  return GEMS.filter((g) => g.day <= maxStreak);
}

/**
 * Gems not yet reached (day > maxStreak), in order.
 */
export function lockedGems(maxStreak) {
  if (!validStreak(maxStreak)) return [...GEMS];
  return GEMS.filter((g) => g.day > maxStreak);
}

/**
 * The first gem with day > maxStreak, or null if all have been earned.
 */
export function nextGem(maxStreak) {
  if (!validStreak(maxStreak)) return GEMS[0] ?? null;
  return GEMS.find((g) => g.day > maxStreak) ?? null;
}

/**
 * Whether a gem has been earned.
 */
export function isEarned(gemId, maxStreak) {
  const gem = gemById(gemId);
  if (!gem) return false;
  return validStreak(maxStreak) && gem.day <= maxStreak;
}

/**
 * Gem lookup by id. Returns the gem object or undefined.
 */
export function gemById(id) {
  return GEMS.find((g) => g.id === id);
}

/**
 * Live progress toward the next gem to earn.
 *
 * @param {number} currentStreak  - User's active streak today (bar fill).
 * @param {number} maxStreak      - Historical best streak (determines which gem is "next").
 * @returns {{ next: object|null, prevDay: number, daysToGo: number, fraction: number }}
 */
export function gemProgress(currentStreak, maxStreak) {
  const next = nextGem(maxStreak);

  // prevDay = day threshold of the most recent earned gem (0 if none earned yet).
  const earned = earnedGems(maxStreak);
  const prevDay = earned.length > 0 ? earned[earned.length - 1].day : 0;

  if (next === null) {
    return { next: null, prevDay, daysToGo: 0, fraction: 1 };
  }

  const span = next.day - prevDay;
  // Use currentStreak for the bar, but clamp to [0, 1].
  const raw = span > 0 ? (currentStreak - prevDay) / span : 0;
  const fraction = Math.min(1, Math.max(0, raw));
  const daysToGo = Math.max(0, next.day - currentStreak);

  return { next, prevDay, daysToGo, fraction };
}

/**
 * Returns the live rarity percentage for a gem from server stats, falling
 * back to the gem's designed rarityPct when live data is unavailable.
 *
 * @param {object} gem        - A GEMS entry ({ day, rarityPct, ... })
 * @param {object|null} liveStats - { [day]: pct } from /v1/halo-stats, or null
 * @returns {number}
 */
export function rarityPctFor(gem, liveStats) {
  const v = liveStats && liveStats[gem.day];
  return (typeof v === 'number' && isFinite(v)) ? v : gem.rarityPct;
}

/**
 * Formats a rarity percentage for display.
 * Values < 1 get one decimal place (e.g. 0.8 → "0.8").
 * Values >= 1 are rounded to the nearest integer (e.g. 33.4 → "33").
 *
 * @param {number} pct
 * @returns {string}
 */
export function formatRarity(pct) {
  return pct < 1 ? pct.toFixed(1) : String(Math.round(pct));
}

/**
 * Display color for a tier.
 */
export function tierColor(tier) {
  switch (tier) {
    case 'Common':    return '#cdac68'; // muted gold
    case 'Uncommon':  return '#c4a86c'; // gold
    case 'Rare':      return '#c79a4e';
    case 'Epic':      return '#c98f3a';
    case 'Legendary': return '#e0a93f';
    case 'Mythic':    return '#f0c44a';
    default:          return '#c4a86c';
  }
}
