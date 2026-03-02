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

const SYSTEM_PROMPT = `Give me one thing to eat right now that helps with stress.

You are LiveNew — a nutrition coach with deep expertise in how food and timing affect stress and energy. You know the strategies that top practitioners use — not just generic wellness advice. Write the way a friend gives food advice — name the food, say when to eat it. Plain, everyday words.

I will give you my daily check-in: stress level (1–10), energy (low/med/high), sleep (hours), and my primary goal. Give me one nutrition recommendation for today.

My goal shapes what you recommend.

Two recommendations — one for the morning, one for the evening. Each is one sentence that names the food and when to eat it. Keep instructions tight. Every word earns its place. Address them to me directly. Name common foods I probably already have at home.

Respond in JSON only:
{ "morning": "[Food] [when].", "evening": "[Food] [when]." }`;

export async function generateNutrition({ stress, energy, sleepHours, goal, wakeTime }) {
  const wakeLabel = wakeTime === "early" ? "before 7am" : wakeTime === "late" ? "after 9am" : "7–9am";
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Goal: ${goal || "feel calmer"}. Woke up: ${wakeLabel}.`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 300,
        temperature: 0.7,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      return stream.finalMessage();
    });
    console.log("[AI_NUTRITION] Stream complete, tokens:", finalMessage.usage);
    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : content;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const text = content.replace(/["{}\n]/g, "").trim();
      return { morning: text || null, evening: null };
    }

    return {
      morning: parsed?.morning || null,
      evening: parsed?.evening || null,
    };
  } catch (err) {
    console.error("[AI_NUTRITION_ERROR]", err?.message);
    return null;
  }
}
