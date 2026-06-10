// ── Aura definitions — PREMIUM-EXCLUSIVE collectible tier ────────────────────
//
// Auras are the premium tier above gold Halos. Every unlock requires isPremium
// — a free user can NEVER earn one. The iridescent palettes are designed to
// read as pearlescent / oil-slick: each is a 4-5-stop journey through adjacent
// hues that feel alive when animated.

export const AURAS = [
  {
    id: 'initiate',
    name: "Initiate's Aura",
    condition: 'Go premium.',
    description: 'The moment you chose depth over surface. This aura marks the crossing.',
    // Warm pearl: champagne → rose-gold → soft violet → pale teal
    palette: ['#f5e6c8', '#e8b89a', '#c49ad6', '#7ecfc4', '#f5e6c8'],
    unlock: ({ isPremium }) => !!isPremium,
  },
  {
    id: 'devoted',
    name: 'Devoted Aura',
    condition: 'Premium · 14-day streak.',
    description: 'Two weeks of showing up with intent. The nervous system has begun to remember.',
    // Rose-to-violet: blush → dusty rose → orchid → periwinkle → lavender ice
    palette: ['#f2c4ce', '#d98fa0', '#b97ab8', '#8490d4', '#c8d4f0'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 14,
  },
  {
    id: 'ascendant',
    name: 'Ascendant Aura',
    condition: 'Premium · 30-day streak.',
    description: 'A full month. Cortisol has a new normal. The aura knows.',
    // Deep iridescent: midnight blue → electric violet → jade → aurora teal → silver
    palette: ['#8ab4e8', '#9b7ee0', '#5ec4a8', '#4dd9c0', '#c8daf5'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 30,
  },
  {
    id: 'eternal',
    name: 'Eternal Aura',
    condition: 'Premium · 100-day streak.',
    description: 'One hundred days. You are no longer building a habit. You are the habit.',
    // Deep oil-slick: amber-gold → hot coral → magenta → indigo → arctic blue
    palette: ['#e8c46a', '#e89070', '#c464a8', '#7060d0', '#80c8f0'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 100,
  },
  {
    id: 'paragon',
    name: 'Paragon Aura',
    condition: 'Premium · all halos earned.',
    description: 'All eight gold halos. All of Iris, witnessed. There is nothing left to prove — only to be.',
    // Full spectrum pearl: platinum → gold-rose → violet → cyan → pearl white
    palette: ['#f0f0e8', '#e8c490', '#c090e0', '#60d0d8', '#f0f0e8'],
    unlock: ({ isPremium, allHalosEarned }) => !!isPremium && !!allHalosEarned,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Look up an aura by id. Returns the aura object or undefined.
 */
export function auraById(id) {
  return AURAS.find((a) => a.id === id);
}

/**
 * Returns all auras the user has earned, given the context.
 * ctx = { isPremium: bool, maxStreak: number, allHalosEarned: bool }
 */
export function earnedAuras(ctx) {
  return AURAS.filter((a) => a.unlock(ctx));
}

/**
 * Whether a specific aura has been earned.
 */
export function isAuraEarned(id, ctx) {
  const aura = auraById(id);
  if (!aura) return false;
  return aura.unlock(ctx);
}
