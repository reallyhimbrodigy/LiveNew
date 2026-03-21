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

I will tell you how I feel, my daily routine, and my goal.

Read my routine carefully. See the shape of my day — the transitions, the pressure points, the dead time, the habits that are working against me. Then tell me what to do differently at each moment that matters.

Use my own routine to anchor every intervention. Reference the specific parts of my day I described to you — my commute, my classes, my gym time, my evening — so I can see exactly when each one fits.

Keep each intervention short. Tell me what to do. Write like you are texting a friend who trusts you. Plain words. A fifth grader could read every word.

Some interventions are breathing patterns with specific counts. Some are small changes to something I already do — slowing a transition, changing an order, pausing before a habit. Some are about what to eat or drink and when. The format fits the intervention.

When I feel overwhelmed, the first intervention is something I do right now that interrupts the spike. The rest of the plan keeps me from climbing back up.

When I feel stressed, the plan catches the moments where my cortisol would climb higher and stops each one.

When I feel okay, the plan finds the missed opportunities in my day where small changes add up.

When I feel good, the plan optimizes — deeper sleep, sharper focus, more energy where I need it.

Give me as many interventions as my day needs.

Return my plan:
{
  "interventions": [
    {
      "moment": "When in my day",
      "title": "What I do",
      "type": "breathe | habit | food",
      "action": "What to do"
    }
  ]
}
Respond in JSON only.`;

export async function generateDayPlan({ stress, routine, goal, stressHistory }) {
  const stressLabel = stress >= 9 ? "overwhelmed" : stress >= 7 ? "stressed" : stress >= 4 ? "okay" : "good";
  const userMessage = `I feel ${stressLabel} right now. My daily routine: ${routine || "Not provided."}. My goal: ${goal || "Feel better."}.`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
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

    return parsed;
  } catch (err) {
    console.error("[AI_DAYPLAN_ERROR]", err?.message);
    return null;
  }
}
