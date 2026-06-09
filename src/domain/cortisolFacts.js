/**
 * Cortisol consequence facts — "scary stat" motivation hooks.
 *
 * Each fact is real, Gen-Z-relevant, and scientifically grounded.
 * The hook is short and sharp; the detail is calm and explanatory.
 * No clickbait inflation — if it's here, the research backs it.
 */
export const CORTISOL_FACTS = [
  {
    id: 'acne',
    hook: 'High cortisol fuels breakouts.',
    detail: 'Stress raises sebum production and skin inflammation — it is one of the most consistently documented triggers of adult acne.',
    tag: 'skin',
  },
  {
    id: 'sleep',
    hook: 'Cortisol at night wrecks your sleep.',
    detail: 'Elevated evening cortisol delays melatonin onset and fragments deep sleep, leaving you unrecovered no matter how many hours you log.',
    tag: 'sleep',
  },
  {
    id: 'belly',
    hook: 'Stress deposits fat on your stomach.',
    detail: 'Cortisol preferentially drives visceral fat storage around the abdomen — even without overeating or a calorie surplus.',
    tag: 'body',
  },
  {
    id: 'focus',
    hook: 'Cortisol shrinks your ability to focus.',
    detail: 'Sustained stress impairs the prefrontal cortex — the region you rely on to concentrate, plan, and make decisions.',
    tag: 'cognition',
  },
  {
    id: 'memory',
    hook: 'Chronic stress dulls your memory.',
    detail: 'Prolonged cortisol exposure is linked to reduced hippocampal activity and measurably worse recall and learning.',
    tag: 'cognition',
  },
  {
    id: 'immune',
    hook: 'Stress lowers your immune defenses.',
    detail: 'Chronically high cortisol suppresses immune response, making you more susceptible to infections you would otherwise fight off.',
    tag: 'health',
  },
  {
    id: 'aging',
    hook: 'Cortisol ages your skin faster.',
    detail: 'Stress accelerates collagen breakdown — the structural protein that keeps skin firm — producing visible aging ahead of schedule.',
    tag: 'skin',
  },
  {
    id: 'energy',
    hook: 'The afternoon crash is a cortisol problem.',
    detail: 'A poorly-regulated cortisol curve drops sharply in the early afternoon, which is what drives the 2–4pm energy slump most people accept as normal.',
    tag: 'energy',
  },
  {
    id: 'mood',
    hook: 'Cortisol and anxiety reinforce each other.',
    detail: 'Elevated cortisol amplifies the brain\'s threat response, making anxious spirals easier to start and harder to exit.',
    tag: 'mood',
  },
  {
    id: 'hormones',
    hook: 'Chronic stress suppresses your hormones.',
    detail: 'The body treats cortisol production as a survival priority, borrowing from the same precursors used to make testosterone, estrogen, and progesterone.',
    tag: 'hormones',
  },
  {
    id: 'gut',
    hook: 'Stress disrupts your gut.',
    detail: 'High cortisol alters gut motility and permeability, contributing to bloating, cramping, and microbiome imbalance.',
    tag: 'health',
  },
];

const _length = CORTISOL_FACTS.length;

/**
 * Look up a fact by its id. Returns undefined if not found.
 * @param {string} id
 */
export function factById(id) {
  return CORTISOL_FACTS.find((f) => f.id === id);
}

/**
 * Return a fact at the given index, wrapping safely for any integer
 * including negatives and values beyond the array length.
 * @param {number} i
 */
export function factForIndex(i) {
  return CORTISOL_FACTS[((i % _length) + _length) % _length];
}
