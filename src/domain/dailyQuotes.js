// ── Daily motivational quotes ────────────────────────────────────────────────
// Short, punchy, single-line quotes. Rotates by calendar day — same date
// always returns the same quote (deterministic, no storage needed).
// Sources: Stoics, athletes, and universal wisdom. No filler. No fluff.

export const DAILY_QUOTES = [
  { id: 'ali_will',         text: "Don't count the days; make the days count.",                 author: 'Muhammad Ali' },
  { id: 'aurelius_present', text: 'Confine yourself to the present.',                            author: 'Marcus Aurelius' },
  { id: 'seneca_suffer',    text: 'We suffer more in imagination than in reality.',              author: 'Seneca' },
  { id: 'epictetus_react',  text: "It's not what happens to you, but how you react to it that matters.", author: 'Epictetus' },
  { id: 'discipline',       text: 'Discipline is choosing between what you want now and what you want most.', author: 'Augusta F. Kantra' },
  { id: 'aurelius_act',     text: 'Do what nature requires. Set out immediately if possible.',  author: 'Marcus Aurelius' },
  { id: 'seneca_time',      text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
  { id: 'epictetus_mind',   text: 'Make the best use of what is in your power, and take the rest as it happens.', author: 'Epictetus' },
  { id: 'ali_impossible',   text: 'Impossible is nothing.',                                      author: 'Muhammad Ali' },
  { id: 'calm_breath',      text: 'The body calms the mind. The mind calms the day.',            author: '—' },
  { id: 'consistency',      text: 'Small actions, compounded daily, become the whole.',          author: '—' },
  { id: 'aurelius_within',  text: 'You have power over your mind — not outside events.',        author: 'Marcus Aurelius' },
  { id: 'seneca_waste',     text: 'It is not that we have a short time to live, but that we waste much of it.', author: 'Seneca' },
  { id: 'showing_up',       text: 'The secret is that there is no secret. Show up. Repeat.',    author: '—' },
  { id: 'epictetus_expect', text: 'Seek not that the things which happen should happen as you wish; but wish the things which happen to be as they are.', author: 'Epictetus' },
  { id: 'resilience',       text: 'The obstacle is the way.',                                    author: 'Marcus Aurelius' },
];

const L = DAILY_QUOTES.length;

/**
 * Returns the quote for a given date. Deterministic: same date → same quote.
 * @param {Date} [date]
 * @returns {{ id: string, text: string, author: string }}
 */
export function quoteForDay(date = new Date()) {
  const idx = Math.floor(date.getTime() / 86400000) % L;
  return DAILY_QUOTES[((idx % L) + L) % L];
}

/**
 * Look up a quote by its id string.
 * @param {string} id
 * @returns {{ id: string, text: string, author: string } | undefined}
 */
export function quoteById(id) {
  return DAILY_QUOTES.find((q) => q.id === id);
}
