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

const SYSTEM_PROMPT = `You are LiveNew — a nutrition coach. You know what foods help with stress and energy.

I will give you my stress level, energy, sleep, and goal. Give me two food recommendations: one for the morning, one for the evening.

Each recommendation is one sentence. Each sentence names a specific common food and when to eat it. Nothing else in the sentence — no explanations, no nutrients, no health claims.

Examples of good sentences:
- "Scramble two eggs with spinach before 10am."
- "Eat a banana with peanut butter around 8pm."

Examples of bad sentences (DO NOT write like this):
- "Eat eggs with spinach — the B vitamins calm your nervous system."
- "Have a banana — the magnesium helps you sleep."

The good sentences name the food and the time. The bad sentences explain why. Write only good sentences.

Respond in JSON only:
{ "morning": "sentence", "evening": "sentence" }`;

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
