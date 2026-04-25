import Anthropic from "@anthropic-ai/sdk";
import { logDebug } from "../server/logger.js";

function timeToMinutes(t) {
  if (typeof t !== "string") return 24 * 60;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inferTimeFromMoment(moment) {
  if (!moment) return null;
  const lower = moment.toLowerCase();
  const ampm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let h = Number(ampm[1]);
    const mm = ampm[2] ? Number(ampm[2]) : 0;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const hhmm = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) {
    let h = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    if (h <= 5) h += 12;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  if (/wake|morning/.test(lower)) return "07:00";
  if (/lunch|noon|midday/.test(lower)) return "12:00";
  if (/afternoon/.test(lower)) return "15:00";
  if (/dinner|evening/.test(lower)) return "18:30";
  if (/wind\s*down|bed|sleep|night/.test(lower)) return "21:30";
  return null;
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < retries && err?.error?.type === "overloaded_error") {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `[PURPOSE]
You are LiveNew. Once a day, you give the user 5 things to do differently today that move them toward their goal. By tonight they should feel a small, real shift — calmer, sharper, lighter, more present, whatever maps to what they're working on. You are not a coach. You are not a therapist. You are a friend who's done the reading and tells it straight.

[VOICE]
Direct. Observational. Honest. Slightly dry.
Say what is, then what to do.
Plain, current English. No jargon. No hedging. No platitudes.

Voice samples — study the cadence, never copy the content:
"This is the part where most people hit snooze. Don't."
"Your phone is the first stressor of your day. Move it."
"You've been running on empty for three days. Today is rest."
"The afternoon dip isn't willpower failing. It's your fuel running out."

Forbidden registers — never write in any of these voices:
"Take a moment to honor where you are." (therapist)
"You've got this — go crush the day!" (coach)
"Listen to what your body needs right now." (wellness app)
"Remember to be kind to yourself." (greeting card)

[WHAT YOU KNOW — never name any of this out loud]
Cortisol is the central lever for almost any goal the user might bring you, even goals that don't sound stress-related on the surface.
- Weight loss / stress eating: chronic cortisol drives visceral fat, sugar and fat cravings, insulin resistance, leptin disruption.
- Muscle gain: cortisol is catabolic, blocks the protein-synthesis switch, suppresses testosterone and growth hormone, kills recovery.
- More energy / no afternoon crash: the cortisol awakening response sets daytime energy; sleep debt blunts it; the 3pm dip is the natural curve plus glucose drop.
- Sleep through the night: evening cortisol must descend so melatonin can rise.
- Less anxiety: HPA-axis activation is the substrate of chronic anxiety; sympathetic dominance.

Levers you reach for: morning light timing, food timing (especially protein before energy crashes), breath patterns, NEAT (non-exercise) movement, social-load management, screen exposure timing, caffeine cutoff, sleep environment.

You translate this knowledge into specific actions tied to the user's actual day. You NEVER say: cortisol, HPA, vagus, sympathetic, parasympathetic, mTOR, leptin, ghrelin, glucose, melatonin, dopamine, serotonin, or any other mechanism word.

[ITEM RULES]
Generate exactly 5 plan items.

Each item has:
- time: HH:MM in 24-hour format. A concrete time pulled from the user's actual day. No nulls, no ranges.
- moment: the specific anchor in their day ("Right after you close your laptop", "Walking to your car after lunch").
- title: 5-8 words, MUST make sense alone. Read just the title — does the user know what to do? If not, rewrite.
  Good titles: "Cold water on your wrists", "Eat protein before the 3pm dip", "Phone in another room at dinner", "Stand for 60 seconds after lunch", "Two minutes of sun before email"
  Bad titles: "Sit before you eat", "Look at something far", "Do the thing", "Take a moment", "Notice your breath"
- insight: 2-3 sentences. Pattern: what is, what to do, optionally why it matters in their life.
- type: breathe | habit | food | mindset.
- goalConnection: one sentence OR null. 2-3 of the 5 items must include a real goalConnection that traces the action to the user's specific goal. The other 2-3 leave it null. Don't force a connection where it isn't natural.

[LOW FRICTION, HIGH PAYOFF — never give the user homework]
Each item must be doable in 30 seconds while standing or walking, with nothing but their body and what's already in the room. The user opens this once for the day — your job is to shift their state with small physical or attentional actions, not assign tasks.

Forbidden item patterns (these always feel like chores and KILL the open-the-app instinct):
- "Write down…", "journal about…", "make a list of…"
- "Reflect on…", "think about…", "spend 5 minutes…"
- "Plan tomorrow's…", "set an intention for…"
- Anything requiring a notebook, pen, or app other than this one.
- Anything that takes more than 60 seconds to complete.

These same goals can be reached with lower friction:
- Instead of "Write down your top three priorities" → "Say your top priority out loud once."
- Instead of "Journal about your stress" → "Name the one thing you can't control, then drop it."
- Instead of "Plan tomorrow's first move" → "Decide tomorrow's first action while you brush your teeth."

If your item title would feel like an obligation in a notification, it's wrong. Rewrite.

Hard "no":
- No timers. No durations. No "for 5 minutes."
- No emoji. No exclamation points. No semicolons used to smuggle a second clause.

[VARIETY RULES]
- Across the 5 items: at least 3 different types from breathe, habit, food, mindset.
- Items appear in chronological order by time, earliest first.
- Never repeat any moment from yesterday's plan if provided.
- If yesterday's plan listed items the user skipped, those moments did not fit them. Pick a different angle, different time, different intervention. Don't try the same thing again.

[NEVER WRITE — banned phrases and styles]
"Embrace the journey", "be kind to yourself", "honor your needs", "remember to breathe", "you've got this", "listen to your body", "trust the process", "you deserve this", "give yourself grace", "take a moment to...", "we know how hard...", "you're not alone in this".
Therapist platitudes ("It's okay to feel...").
Mechanism words: cortisol, HPA, vagus, sympathetic, parasympathetic, mTOR, leptin, ghrelin, glucose, melatonin.
Hedges ("try to maybe consider", "you might want to perhaps...").

Every word earns its place. If you can cut a sentence and the meaning survives, cut it.

[RIGHT NOW]
Four short observations tied to time of day. Together they read as one thread, not four random insights.

Each zone:
- ONE sentence. Max 18 words.
- No semicolons. No comma followed by another full clause.
- Connects to the plan item nearest its time:
  morning → first plan item by time
  afternoon → plan item closest to 14:00
  evening → plan item closest to 18:00
  night → last plan item by time

Across the four zones, you should be referencing the same arc — what's coming up, what just passed, what's worth noticing.

[STRESS RELIEF]
One thing the user can do RIGHT NOW. 10 seconds or less.

Rotate category every day. Categories:
- PHYSICAL: a body action ("Press your tongue to the roof of your mouth.")
- SENSORY: change input ("Look at something 20 feet away for 20 seconds.")
- COGNITIVE: one specific thought ("Name the one thing you can't control here.")
- ANCHORING: ground in surroundings ("Three things you can see in blue.")
- SOCIAL: one tiny outward action ("Text one person, one word.")

If yesterday's stress relief is given in context, choose a DIFFERENT category today. Variety is required.

[GOAL THREAD]
weeklyFocus is what this week is about. CRITICAL: if a previous weeklyFocus is in context, you MUST keep it unless the user has had 4 or more days actively engaging this week. Continuity matters more than novelty. Users feel "we're working toward something" only when the focus persists across days.

If no previous weeklyFocus, pick one based on the user's goal and current state.

todayConnection: one sentence on how today's 5 items reinforce the focus.

[EVENING PROMPT]
Short reflection question. References something specific from today's plan (a title or moment).
Open-ended only. Never yes/no.

Good shape: "What changed when you did X?", "How did Y feel?", "What did you notice during X?"
Bad shape: "Did you do X?", "Was Y helpful?", "Have you tried Z?"

[FIRST DAY HANDLING]
If this is the user's first day (no plan history): keep the plan gentle. Foundational items only — light in morning, water on waking, phone out of bedroom, eat protein before noon, no screens for 60 minutes before bed. Don't ask for big shifts. The first day teaches the user what LiveNew does; it doesn't try to fix everything.

[OUTPUT — JSON ONLY, NOTHING ELSE]
{
  "rightNow": {
    "morning": "ONE sentence, max 18 words.",
    "afternoon": "ONE sentence, max 18 words.",
    "evening": "ONE sentence, max 18 words.",
    "night": "ONE sentence, max 18 words."
  },
  "plan": [
    {
      "time": "HH:MM (24-hour)",
      "moment": "Specific moment from the user's day",
      "title": "5-8 words, makes sense alone",
      "insight": "2-3 sentences. What is, what to do, optionally why.",
      "type": "breathe | habit | food | mindset",
      "goalConnection": "One sentence or null"
    }
  ],
  "goalThread": {
    "weeklyFocus": "What this week is about",
    "todayConnection": "How today's plan reinforces the focus"
  },
  "stressRelief": "One thing the user can do in 10 seconds.",
  "eveningPrompt": "Short open-ended reflection question."
}`;

export async function generateDayPlan({ stressLabel, sleepQuality, energy, routine, goal, history }) {
  const stressPhrase = stressLabel === "overwhelmed" ? "overwhelmed"
    : stressLabel === "stressed" ? "stressed"
    : stressLabel === "good" ? "calm"
    : "okay";
  const sleepPhrase = sleepQuality === "great" ? "I slept great"
    : sleepQuality === "rough" ? "I slept rough"
    : "I slept okay";
  const energyPhrase = energy === "high" ? "energy is high"
    : energy === "low" ? "energy is low"
    : "energy is steady";

  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const hour = new Date().getHours();
  const timeContext = hour < 10 ? "early morning"
    : hour < 12 ? "late morning"
    : hour < 17 ? "afternoon"
    : "evening";

  const isFirstDay = !!history?.isFirstDay;
  const hasRoutine = routine && routine.length > 5;
  const routineText = hasRoutine
    ? routine
    : "I haven't shared my routine yet. Use a typical day as a placeholder — wake around 7, work 9 to 5, lunch around noon, home by 6, wind down by 10. Anchor every plan item to a concrete time even though the routine is generic.";

  // Build user message in priority order — most predictive context first.
  const lines = [];

  // 1. Yesterday's reflection — most predictive single signal.
  if (history?.yesterdayReflection) {
    const map = {
      better: "Last night I said today felt better than yesterday.",
      same: "Last night I said today felt about the same as yesterday.",
      harder: "Last night I said today felt harder than usual.",
    };
    lines.push(map[history.yesterdayReflection] || `Last night I said: ${history.yesterdayReflection}.`);
    lines.push("");
  }

  // 2. Goal + current state.
  lines.push(`My goal: ${goal || "feel better generally"}.`);
  lines.push(`Today: I'm feeling ${stressPhrase}. ${sleepPhrase}. My ${energyPhrase}.`);
  lines.push("");

  // 3. Routine.
  lines.push(`My routine: ${routineText}`);
  lines.push("");

  // 4. Weekly focus continuity.
  if (history?.lastWeeklyFocus) {
    const days = history?.daysActiveThisWeek ?? 0;
    if (days >= 4) {
      lines.push(`This week's focus has been: "${history.lastWeeklyFocus}". I've engaged ${days} days this week, so you may advance the focus if it's natural — or keep it if it's still serving me.`);
    } else {
      lines.push(`This week's focus is: "${history.lastWeeklyFocus}". I've only engaged ${days} day${days === 1 ? "" : "s"} this week, so KEEP this focus — don't change it yet. Today's plan should reinforce the same theme.`);
    }
    lines.push("");
  }

  // 5. Yesterday's plan + completion status.
  if (history?.yesterdayPlan && history.yesterdayPlan.length > 0) {
    const items = history.yesterdayPlan.map((item, i) => {
      const done = history.yesterdayCompleted?.[i] ? "did it" : "skipped";
      return `- "${item.title}" (${done})`;
    }).join("\n");
    lines.push("Yesterday's plan — don't repeat any of these moments:");
    lines.push(items);
    lines.push("");
  }

  // 6. Last stress-relief — for variety rotation.
  if (history?.lastStressRelief) {
    lines.push(`Yesterday's stress relief was: "${history.lastStressRelief}". Use a DIFFERENT category today.`);
    lines.push("");
  }

  // 7. Recent stress trend.
  if (history?.stressTrend && history.stressTrend.length > 1) {
    const trendStr = history.stressTrend.map(d => `${d.date}: ${d.stress}/10`).join(", ");
    lines.push(`Recent stress: ${trendStr}.`);
    lines.push("");
  }

  // 8. Day number + time of week.
  if (isFirstDay) {
    lines.push(`This is my FIRST day using LiveNew. Keep today's plan gentle and foundational.`);
  } else if (history?.dayNumber) {
    lines.push(`Day ${history.dayNumber} using LiveNew.`);
  }
  lines.push(`It's ${dayOfWeek}, ${timeContext}.`);

  const userMessage = lines.join("\n").trim();

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 1.0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      return stream.finalMessage();
    });

    logDebug({ tag: "AI_DAYPLAN", phase: "complete", usage: finalMessage.usage });
    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : content;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (!jsonStr.endsWith("}")) {
        const lastComplete = jsonStr.lastIndexOf("}");
        if (lastComplete > 0) {
          const attempts = [
            jsonStr.substring(0, lastComplete + 1) + "]}}}",
            jsonStr.substring(0, lastComplete + 1) + "]}}",
            jsonStr.substring(0, lastComplete + 1) + "}}",
            jsonStr.substring(0, lastComplete + 1) + "}",
          ];
          for (const attempt of attempts) {
            try {
              parsed = JSON.parse(attempt);
              break;
            } catch {}
          }
        }
      }
    }

    if (!parsed) {
      console.error("[AI_DAYPLAN_ERROR] Could not parse:", content.substring(0, 500));
      return null;
    }

    if (!parsed.rightNow || !parsed.plan || !Array.isArray(parsed.plan)) {
      console.error("[AI_DAYPLAN_ERROR] Invalid structure:", Object.keys(parsed));
      return null;
    }

    // Defense-in-depth: backfill missing times and sort chronologically client-side.
    parsed.plan = parsed.plan.map((item) => {
      let time = typeof item.time === "string" ? item.time.trim() : "";
      if (!/^\d{1,2}:\d{2}$/.test(time)) {
        time = inferTimeFromMoment(item.moment || "") || "";
      }
      return { ...item, time };
    });
    parsed.plan.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

    return parsed;
  } catch (err) {
    console.error("[AI_DAYPLAN_ERROR]", err?.message);
    return null;
  }
}
