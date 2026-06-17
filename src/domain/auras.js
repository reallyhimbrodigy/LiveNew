// ── Aura definitions — milestone TROPHIES (one free, the rest premium) ───────
//
// Auras are the prestige tier above the gold Halos: a trophy case of your
// cortisol journey. Each one is EARNED at a real milestone — not bought — so it
// means something. The first ("Pearl") is FREE: every user earns it at a
// 3-day streak, so they taste the collectible system early. The rest are
// premium, marking the deeper milestones only committed users reach.
//
// The iridescent palettes read as pearlescent / oil-slick: each is a 4-5-stop
// journey through adjacent hues that feels alive when animated.
//
// unlock(ctx) ctx = { isPremium, maxStreak, allHalosEarned }. `free: true`
// auras never require premium — their milestone is the only gate.

export const AURAS = [
  {
    id: 'initiate',
    name: 'Pearl Aura',
    free: true,
    condition: '3-day streak · free',
    description: 'Three days back to back — your first trophy. Proof you came back when it would have been easier not to. The collection starts here.',
    // Warm pearl: champagne → rose-gold → soft violet → pale teal
    palette: ['#f5e6c8', '#e8b89a', '#c49ad6', '#7ecfc4', '#f5e6c8'],
    unlock: ({ maxStreak }) => (maxStreak || 0) >= 3,
  },
  {
    id: 'devoted',
    name: 'Devoted Aura',
    free: false,
    condition: 'Premium · 14-day streak',
    description: 'Two weeks of showing up with intent. The nervous system has begun to remember. A trophy for the first real stretch.',
    // Rose-to-violet: blush → dusty rose → orchid → periwinkle → lavender ice
    palette: ['#f2c4ce', '#d98fa0', '#b97ab8', '#8490d4', '#c8d4f0'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 14,
  },
  {
    id: 'ascendant',
    name: 'Ascendant Aura',
    free: false,
    condition: 'Premium · 30-day streak',
    description: 'A full month. Cortisol has a new normal. This trophy only sits with people who changed something real.',
    // Deep iridescent: midnight blue → electric violet → jade → aurora teal → silver
    palette: ['#8ab4e8', '#9b7ee0', '#5ec4a8', '#4dd9c0', '#c8daf5'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 30,
  },
  {
    id: 'eternal',
    name: 'Eternal Aura',
    free: false,
    condition: 'Premium · 100-day streak',
    description: 'One hundred days. You are no longer building a habit — you are the habit. Almost no one holds this trophy.',
    // Deep oil-slick: amber-gold → hot coral → magenta → indigo → arctic blue
    palette: ['#e8c46a', '#e89070', '#c464a8', '#7060d0', '#80c8f0'],
    unlock: ({ isPremium, maxStreak }) => !!isPremium && (maxStreak || 0) >= 100,
  },
  {
    id: 'paragon',
    name: 'Paragon Aura',
    free: false,
    condition: 'Premium · every gem earned',
    description: 'All eight gems. All of Iris, witnessed. The rarest trophy there is — nothing left to prove, only to be.',
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

/**
 * Whether the aura is locked ONLY because the user isn't premium (its milestone
 * is met but premium isn't). Lets the UI show "unlock with premium" vs a
 * still-unreachable milestone. Free auras are never premium-locked.
 */
export function isAuraPremiumLocked(id, ctx) {
  const aura = auraById(id);
  if (!aura || aura.free) return false;
  if (aura.unlock(ctx)) return false;               // already earned
  const asPremium = aura.unlock({ ...ctx, isPremium: true });
  return asPremium;                                  // would be earned if premium
}
