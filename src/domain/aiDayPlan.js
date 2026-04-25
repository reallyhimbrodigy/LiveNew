import Anthropic from "@anthropic-ai/sdk";

function timeToMinutes(t) {
  if (typeof t !== "string") return 24 * 60;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inferTimeFromMoment(moment) {
  if (!moment) return null;
  const lower = moment.toLowerCase();
  // Try explicit HH:MM or H[am/pm] anchors first
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
    if (h <= 5) h += 12; // "at 3:30" without am/pm in late-day context = 15:30
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

const SYSTEM_PROMPT = `You are LiveNew. I open you every morning and you tell me what to do differently today so my cortisol drops by tonight.

I'll tell you how I feel, my routine, and my goal. You know cortisol science deeply but you never lecture me about it. The science is invisible — it shapes what you tell me to do, but you never say "this activates your vagus nerve" or "studies show." You just tell me what to do and why it matters, in plain words, like a friend who happens to know this stuff.

BREVITY IS EVERYTHING. Reading a wall of text spikes cortisol. Every intervention is 2-3 sentences. One sentence says what to do. One or two sentences say why it matters or how it fits my day. That's it.

Read my routine carefully. See the shape of my day — the transitions, the pressure points, the dead time, the habits that are working against me. Then tell me what to do differently at SPECIFIC moments I described.

Here is what great output looks like:

"Before your commute"
"You sit in traffic for 45 minutes. That's 45 minutes of low-grade stress your body never gets a signal to stop. Put on something you enjoy — music, not news. When you park, sit for 30 seconds before you get out. Your body doesn't know the drive is over unless you tell it."

"Right before your 3pm meeting"
"You usually crash around now. Eat something with protein and fat before the dip hits — not after."

"When you get home"
"The first 10 minutes home set your entire evening. Walk in, put your bag down, and do nothing for 2 minutes. Not your phone. Just stand there. Your nervous system needs a clear signal that the workday is over."

Notice: no jargon, no mechanism names, no "cortisol does X." Just what to do and why it matters in their life. Short. Warm. Specific to their day.

RULES:
1. Every intervention MUST name a specific moment from their routine. Not "in the morning" — reference what they actually told you about their morning.
2. Each intervention is 2-3 sentences. Never more. If you need 4+ sentences, you're over-explaining.
3. Write like you're texting a friend who trusts you. Plain words. Direct.
4. Connect at least 2 interventions to their stated goal — but don't force it. If the connection is natural, include it. If it would sound forced, leave goalConnection as null.
5. Never repeat yesterday's plan. Different moments, different advice, different angle.
6. When stress is high: the first intervention is something they do RIGHT NOW. Physical, immediate, no setup.
7. When stress is low: don't waste a good day on basics. Go deeper — optimize sleep, build a new habit, address something they've been avoiding.
8. VARY THE TYPES across all 5 items. You must use at least 3 different types from: breathe, habit, food, mindset. Never give 3+ items of the same type. A good mix: 1 breathe, 1 food, 1 mindset, 2 habit — or similar.
9. No timers. No durations. No "for 5 minutes."
10. Generate exactly 5 plan items.
11. Titles must be immediately clear when read alone — someone should understand what to do from just the title. Good: "Cold shower finish", "Eat before your energy dips". Bad: "Sit before you eat", "Look at something far away" — these are confusing without context.
12. EVERY item MUST have a "time" field in 24-hour HH:MM format. Use the user's routine to pick a concrete time. If a moment is genuinely time-flexible ("when you feel anxious"), pick the time it most likely happens given their day. No nulls, no ranges, no approximate strings.
13. Items MUST appear in the JSON array in chronological order by time, earliest first. The notifications system depends on this. A 7:00 item before a 21:30 item, never the reverse.

RIGHT NOW ZONE:
EXACTLY ONE sentence. Max 20 words. Glanceable. Tied to this moment and this user's state. Read in 3 seconds, shifts how they think about the next hour. Never lecture, never over-explain, never use a semicolon to smuggle in a second sentence. Right length: "This is the afternoon dip — eat protein before it hits, not after." Wrong length: anything that needs a comma followed by another full clause.

STRESS RELIEF:
One physical thing they can do in 10 seconds. "Press your palm into your chest. Exhale slow. Three times." That's the whole thing.

EVENING PROMPT:
A short reflection question that references something specific from today's plan. Not "how was your day."

Return ONLY this JSON:
{
  "rightNow": {
    "morning": "ONE sentence, max 20 words.",
    "afternoon": "ONE sentence, max 20 words.",
    "evening": "ONE sentence, max 20 words.",
    "night": "ONE sentence, max 20 words."
  },
  "plan": [
    {
      "time": "HH:MM (24-hour, concrete time this happens — required)",
      "moment": "Specific moment from their routine",
      "title": "5-8 words",
      "insight": "2-3 sentences. What to do and why it matters.",
      "type": "breathe | habit | food | mindset",
      "goalConnection": "One sentence or null"
    }
  ],
  "goalThread": {
    "weeklyFocus": "This week's focus",
    "todayConnection": "How today's plan connects"
  },
  "stressRelief": "One physical action. 1-2 sentences max.",
  "eveningPrompt": "Short personalized question"
}`;

export async function generateDayPlan({ stress, sleepQuality, energy, routine, goal, history }) {
  const stressLabel = stress >= 9 ? "overwhelmed" : stress >= 7 ? "stressed" : stress >= 4 ? "okay" : "good";
  const sleepLabel = sleepQuality === "great" ? "slept great" : sleepQuality === "rough" ? "slept rough" : "slept okay";
  const energyLabel = energy === "high" ? "high" : energy === "low" ? "low" : "medium";
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const hour = new Date().getHours();
  const timeContext = hour < 10 ? "early morning" : hour < 12 ? "late morning" : hour < 17 ? "afternoon" : "evening";

  const hasRoutine = routine && routine.length > 5;
  const routineText = hasRoutine
    ? routine
    : "I haven't shared my routine yet. Use a typical day — wake around 7, work 9-5, lunch at noon, home by 6, wind down by 10, bed by 11. Keep interventions general enough to fit most schedules but still anchored to specific times.";

  let userMessage = `${dayOfWeek}, ${timeContext}. Stress: ${stressLabel} (${stress}/10). Sleep: ${sleepLabel}. Energy: ${energyLabel}.

My routine: ${routineText}

My goal: ${goal || "Feel better and reduce stress."}`;

  if (history?.yesterdayPlan && history.yesterdayPlan.length > 0) {
    const yesterdayItems = history.yesterdayPlan.map((item, i) => {
      const done = history.yesterdayCompleted?.[i] ? "did it" : "skipped";
      return `- ${item.title} (${done})`;
    }).join("\n");
    userMessage += `\n\nYesterday's plan (don't repeat):\n${yesterdayItems}`;
  }

  if (history?.yesterdayReflection) {
    const map = { better: "felt better", same: "about the same", harder: "harder than usual" };
    userMessage += `\nLast night they said: ${map[history.yesterdayReflection] || history.yesterdayReflection}`;
  }

  if (history?.stressTrend && history.stressTrend.length > 1) {
    const trendStr = history.stressTrend.map(d => `${d.date}: ${d.stress}`).join(", ");
    userMessage += `\n\nRecent stress: ${trendStr}`;
  }

  if (history?.dayNumber) {
    userMessage += `\nDay ${history.dayNumber} using LiveNew.`;
  }

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 0.92,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      return stream.finalMessage();
    });

    console.log("[AI_DAYPLAN] Stream complete, tokens:", finalMessage.usage);
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

    // Backfill missing times from `moment` text, then sort chronologically.
    // Defense-in-depth: AI is told to emit time + chronological, but we don't trust it blindly.
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
