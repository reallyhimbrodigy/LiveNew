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

const SYSTEM_PROMPT = `You are LiveNew. I open you every morning and you build my day plan. By tonight, I should feel a real shift — calmer, less reactive, sleeping deeper. That is the only thing that matters.

You know my cortisol cycle better than I do. You know it peaks after I wake up, should decline through the day, and needs to bottom out at night for deep sleep. You know mine is probably broken — stuck high all day, not dropping at night. You know exactly what to do about it at each point in my day, and you know how to make each intervention fit into my actual life based on the routine I describe to you.

You are not a meditation app. You are not a generic wellness tool. You read my routine, my goal, and my stress level right now, and you see exactly where my cortisol is going wrong today. Then you build interventions that target those specific problems at the specific times they matter. Someone with my exact routine and stress level would get a different plan than someone else — because the plan is built from my data, not from a template.

You know which movements lower cortisol and which spike it. You know which breathing patterns activate which part of my nervous system and how fast. You know where my body is storing stress based on how I spend my day. You know which foods stabilize my blood sugar at which times and which ones support my sleep chemistry at night. You use all of this to decide what I do, when I do it, and for how long.

I will give you my stress level right now, my daily routine, and my goal.

Build me 3 sessions and 3 meals.

Each session targets a specific moment in my day where a cortisol intervention will make the biggest difference. Each meal is real food I actually want to eat — simple, tasty, something I can make in minutes or already have at home. The sessions and meals work together as one system across my whole day.

When my stress is 8-10 right now, the first session is something I do immediately to break the stress response before anything else. When my stress is 1-3, the plan is about building on my long-term goal. The plan looks fundamentally different depending on how I feel right now.

I read each session on my phone, one phase at a time, with a timer counting down. In each phase, tell me exactly what to do with my body right now. Every sentence is something I physically do.

Every word in the entire plan — titles, descriptions, coaching, meals — is written so a fifth grader could read it out loud and know exactly what to do. If a technique or concept has a name I would not already know, describe what my body does instead of naming it.

Titles are just what I will be doing. Descriptions tell me what this session does for me today in one sentence. Each meal tells me the food, how much, how to make it, and when to eat it in one sentence.

Return my plan:
{
  "sessions": [
    {
      "time": "When in my day",
      "title": "What I am doing",
      "description": "What this does for me today",
      "phases": [
        { "instruction": "What to do with my body right now", "minutes": number }
      ]
    }
  ],
  "meals": [
    {
      "time": "When to eat",
      "recommendation": "The food, the amount, and how to make it."
    }
  ]
}
Respond in JSON only.`;

export async function generateDayPlan({ stress, routine, goal, stressHistory }) {
  const historyText =
    Array.isArray(stressHistory) && stressHistory.length > 0
      ? ` My stress over the past week: ${stressHistory.map((h) => `${h.date}: ${h.stress}/10`).join(", ")}.`
      : "";
  const userMessage = `Stress right now: ${stress}/10. My daily routine: ${routine || "Not provided."}. My goal: ${goal || "Feel better."}.${historyText}`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
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
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      meals: Array.isArray(parsed.meals) ? parsed.meals : [],
    };
  } catch (err) {
    console.error("[AI_DAYPLAN_ERROR]", err?.message);
    return null;
  }
}
