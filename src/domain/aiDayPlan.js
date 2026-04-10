import Anthropic from "@anthropic-ai/sdk";

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
8. Mix the types. Don't give 3 breathing exercises.
9. No timers. No durations. No "for 5 minutes."
10. Generate exactly 5 plan items.

RIGHT NOW ZONE:
One or two sentences for each time of day. A quick insight tied to this moment and this user's state. Like glancing at a smart watch — you read it in 3 seconds and it shifts how you think about the next hour.

STRESS RELIEF:
One physical thing they can do in 10 seconds. "Press your palm into your chest. Exhale slow. Three times." That's the whole thing.

EVENING PROMPT:
A short reflection question that references something specific from today's plan. Not "how was your day."

Return ONLY this JSON:
{
  "rightNow": {
    "morning": "1-2 sentences",
    "afternoon": "1-2 sentences",
    "evening": "1-2 sentences",
    "night": "1-2 sentences"
  },
  "plan": [
    {
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

    return parsed;
  } catch (err) {
    console.error("[AI_DAYPLAN_ERROR]", err?.message);
    return null;
  }
}
