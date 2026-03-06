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

const SYSTEM_PROMPT = `You are LiveNew, an AI cortisol regulation system. You build my complete personalized day plan to lower my cortisol and move me toward my goal.

I will give you my stress level, goal, stress source, available time per session, and any injuries.

Build me three sessions and two food recommendations that work together as one coordinated day:

Morning — I just woke up and I'm starting my day.
Midday — I'm in the middle of my day and stress has been building. I'm reading your instructions on my phone while actively stressed.
Evening — I'm in bed in a dark room. This session transitions my body into deep sleep. What happens here determines my cortisol overnight and how tomorrow starts.
Morning food — supports my morning and my goal.
Evening food — supports my evening and my sleep.

You have expert-level knowledge across exercise physiology, somatic therapy, breathing science, pressure-point techniques, sleep science, and nutritional science. Use ALL of it. For each session, pick whatever combination of movement, breathing, body positions, pressure work, and techniques is most effective for me at that point in my day based on my stress, my goal, and my stress source.

I have no background in any of these fields. Coach me through every detail step by step. Every sentence guides me through what to do right now. Use words a 12-year-old would understand. If something has a technical name, describe what the body does instead.

For nutrition: the food, the amount, the preparation, the timing. I should be able to walk into my kitchen and make it immediately.

The evening session should be lying down or reclined.

Return the plan in this JSON format:
{
  "morning": {
    "title": "What I'll be doing and how it connects to my goal",
    "description": "Summary of this session",
    "phases": [
      { "instruction": "Step-by-step coaching for this part of the session", "minutes": number }
    ]
  },
  "midday": {
    "title": "What I'll be doing",
    "description": "Summary of this session",
    "phases": [
      { "instruction": "Step-by-step coaching for this part of the session", "minutes": number }
    ]
  },
  "evening": {
    "title": "What I'll be doing",
    "description": "Summary of this session",
    "phases": [
      { "instruction": "Step-by-step coaching for this part of the session", "minutes": number }
    ]
  },
  "nutrition": {
    "morning": "One sentence: food, amount, preparation, timing.",
    "evening": "One sentence: food, amount, preparation, timing."
  }
}

Respond in JSON only.`;

export async function generateDayPlan({ stress, goal, stressSource, timeMin, injuries }) {
  const goalMap = {
    perform: "perform better — sharper focus, more energy, less brain fog",
    sleep: "sleep through the night — fall asleep faster, stay asleep, wake up rested",
    weight: "lose stress weight — reduce cortisol-driven fat, stop stress eating",
    calm: "feel like myself again — less anxious, less reactive, more present",
  };
  const goalText = goalMap[goal] || goal || "feel calmer";
  const injuryText = injuries && injuries.length > 0 && injuries[0] !== "none"
    ? " Injuries to work around: " + injuries.join(", ") + "."
    : "";

  const userMessage = `Stress: ${stress}/10. Goal: ${goalText}. Stress source: ${stressSource || "work"}. Time per session: ${timeMin || 10} minutes.${injuryText}`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 6000,
        temperature: 0.85,
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

    return {
      morning: parsed.morning ? {
        id: `ai_morning_${Date.now()}`,
        title: parsed.morning.title || "Your morning",
        description: parsed.morning.description || "",
        phases: Array.isArray(parsed.morning.phases) ? parsed.morning.phases : [],
      } : null,
      midday: parsed.midday ? {
        id: `ai_midday_${Date.now()}`,
        title: parsed.midday.title || "Your midday",
        description: parsed.midday.description || "",
        phases: Array.isArray(parsed.midday.phases) ? parsed.midday.phases : [],
      } : null,
      evening: parsed.evening ? {
        id: `ai_evening_${Date.now()}`,
        title: parsed.evening.title || "Your evening",
        description: parsed.evening.description || "",
        phases: Array.isArray(parsed.evening.phases) ? parsed.evening.phases : [],
      } : null,
      nutrition: {
        morning: parsed.nutrition?.morning || null,
        evening: parsed.nutrition?.evening || null,
      },
    };
  } catch (err) {
    console.error("[AI_DAYPLAN_ERROR]", err?.message);
    return null;
  }
}
