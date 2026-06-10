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

  // ── New batch ─────────────────────────────────────────────────────────────────
  { id: 'ali_heart',        text: 'The fight is won or lost far away from witnesses — behind the lines, in the gym, out there on the road.', author: 'Muhammad Ali' },
  { id: 'seneca_today',     text: 'True happiness is to enjoy the present, without anxious dependence upon the future.', author: 'Seneca' },
  { id: 'aurelius_loss',    text: 'Loss is nothing else but change, and change is nature\'s delight.', author: 'Marcus Aurelius' },
  { id: 'epictetus_wealth', text: 'Wealth consists not in having great possessions, but in having few wants.', author: 'Epictetus' },
  { id: 'ali_champ',        text: 'Champions aren\'t made in gyms. Champions are made from something they have deep inside them.', author: 'Muhammad Ali' },
  { id: 'kobe_one_more',    text: 'You have to work hard in the dark to shine in the light.',     author: 'Kobe Bryant' },
  { id: 'seneca_retreat',   text: 'Retire into yourself as much as you can.', author: 'Seneca' },
  { id: 'aurelius_service', text: 'What we do now echoes in eternity.',                           author: 'Marcus Aurelius' },
  { id: 'proverb_iron',     text: 'Iron sharpens iron.',                                          author: '—' },
  { id: 'proverb_tide',     text: 'Smooth seas do not make skillful sailors.',                    author: '—' },
  { id: 'epictetus_suffer', text: 'Men are disturbed not by things, but by the opinions about things.', author: 'Epictetus' },
  { id: 'ali_believe',      text: 'It\'s the repetition of affirmations that leads to belief.',  author: 'Muhammad Ali' },
  { id: 'aurelius_duty',    text: 'Never let the future disturb you. You will meet it with the same weapons of reason which today arm you against the present.', author: 'Marcus Aurelius' },
  { id: 'proverb_roots',    text: 'The tree that bends survives the storm.',                      author: '—' },
  { id: 'seneca_short',     text: 'The part of life we really live is small — but living well enlarges it.', author: 'Seneca' },
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
