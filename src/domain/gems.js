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

// ── Per-gem jewel palette ─────────────────────────────────────────────────────
//
// Each palette has four roles used by the Halo renderer:
//   core  — the near-white hot-center of the luminous glow (very light tint)
//   mid   — the main jewel color (saturated, rich)
//   deep  — a deeper/darker shade for the shadow side of the ring
//   glow  — the atmospheric bloom color (mid-opacity circles behind the ring)
//
// Design intent: each gem should feel like a distinct precious stone in a
// collection. Common tiers warm gold; upper tiers shift into saturated jewel
// hues. the_year is prismatic — it uses both the mid and the deep for a
// multi-hue sheen that rotates through the AuraHalo cross-fade trick.

export const GEM_PALETTE = {
  // Common — warm antique gold, like a newly minted coin
  first_light: {
    core:  '#fffbe8',   // warm white
    mid:   '#e8c96a',   // bright gold
    deep:  '#a07830',   // dark amber
    glow:  '#d4a832',   // golden bloom
    sheen: '#fff3b0',   // highlight arc
  },
  // Common — burnished bronze, clearly warmer/deeper than first_light's bright
  // coin gold so the two earliest halos never read as the same stone.
  foundation: {
    core:  '#fff0d4',
    mid:   '#c8862a',   // bronze-amber (warmer + deeper than first_light gold)
    deep:  '#7a4a12',   // dark bronze-brown
    glow:  '#b87016',   // amber bloom
    sheen: '#ffdc88',
  },
  // Uncommon — rose-gold / coral: feminine and warm
  the_week: {
    core:  '#fff0ee',
    mid:   '#e8836a',   // rose-coral
    deep:  '#9e3a22',   // deep crimson-brown
    glow:  '#d4604a',
    sheen: '#ffccc0',
  },
  // Rare — teal aquamarine, clear Caribbean water
  rhythm: {
    core:  '#e8fffc',
    mid:   '#3cc4b4',   // teal
    deep:  '#0d6e64',   // deep teal
    glow:  '#1ea89a',
    sheen: '#b0f4ee',
  },
  // Epic — emerald green, lush and saturated
  the_month: {
    core:  '#e8fff0',
    mid:   '#2ec87a',   // emerald
    deep:  '#0a6636',   // deep forest green
    glow:  '#18a858',
    sheen: '#a0ffc8',
  },
  // Epic — sapphire blue, deep ocean depth
  steadfast: {
    core:  '#eaf0ff',
    mid:   '#4a7cf8',   // sapphire
    deep:  '#162880',   // deep cobalt
    glow:  '#2c52e0',
    sheen: '#b0c8ff',
  },
  // Legendary — amethyst violet, regal and luminous
  century: {
    core:  '#f5eeff',
    mid:   '#9a5cf0',   // amethyst
    deep:  '#4a1880',   // deep violet
    glow:  '#7830cc',
    sheen: '#ddb8ff',
  },
  // Mythic — prismatic / iridescent, multi-hue sheen
  the_year: {
    core:  '#ffffff',
    mid:   '#f0c44a',   // warm gold base (hue field, still used by tierColor)
    deep:  '#b042e8',   // violet edge
    glow:  '#e040a0',   // magenta bloom
    sheen: '#ffffff',
    // Extra stops for the rotating prismatic sheen
    prism: ['#f0c44a', '#e05090', '#9060f0', '#40b4f0', '#40d890', '#f0c44a'],
  },
};

// ── Progression ladder ─────────────────────────────────────────────────────────
//
// The Halo renderer drives its visual elaboration off a gem's *progression
// rank* (0 = first_light … 7 = the_year), NOT off its tier band. This is what
// makes each consecutive halo a distinct, monotonically-cooler step on a ladder
// even when two gems share a tier (first_light/foundation both Common;
// the_month/steadfast both Epic). Higher rank ⇒ more rays, faster + richer
// animation, stronger glow, and extra flourishes (counter-rotation, sparkles).

const GEM_RANK = GEMS.reduce((acc, g, i) => {
  acc[g.id] = i;
  return acc;
}, {});

const MAX_GEM_RANK = GEMS.length - 1; // 7 (the_year)

/**
 * Progression rank for a gem: its index in GEMS (0..7). Unknown ids fall back
 * to 0 so a future/unknown gem renders as a subtle entry-level halo.
 *
 * @param {object} gem — a GEMS entry { id, ... }
 * @returns {number} 0..7
 */
export function gemRank(gem) {
  if (!gem) return 0;
  const r = GEM_RANK[gem.id];
  return typeof r === 'number' ? r : 0;
}

/** Highest progression rank (the_year). */
export function maxGemRank() {
  return MAX_GEM_RANK;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the jewel palette for a gem, falling back to a gold palette when
 * the gem id is not found (safe for future gems added without a palette entry).
 *
 * @param {object} gem  — a GEMS entry { id, hue, ... }
 * @returns {{ core, mid, deep, glow, sheen, prism? }}
 */
export function gemPalette(gem) {
  return (
    GEM_PALETTE[gem.id] ?? {
      core:  '#ffffff',
      mid:   gem.hue,
      deep:  '#8c6020',
      glow:  gem.hue,
      sheen: '#fff8c0',
    }
  );
}

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
 * The user's competitive standing = rarity of their highest EARNED halo.
 * Returns { gem, pct } or null if no halo earned yet.
 *
 * @param {number} maxStreak
 * @param {object|null} liveStats - { [day]: pct } from /v1/halo-stats, or null
 * @returns {{ gem: object, pct: number }|null}
 */
export function standing(maxStreak, liveStats) {
  const earned = earnedGems(maxStreak);
  if (!earned.length) return null;
  const gem = earned[earned.length - 1];
  return { gem, pct: rarityPctFor(gem, liveStats) };
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
