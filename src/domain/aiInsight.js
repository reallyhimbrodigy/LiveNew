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

const SYSTEM_PROMPT = `You are LiveNew. I will give you a user's check-in data from the past week — daily stress levels, which sessions they completed, and how many days they checked in.

Write one short paragraph (2-3 sentences) that tells them what changed, what's working, and one thing to focus on this week. Write the way a supportive coach talks after reviewing someone's week. Plain, everyday words. Be specific — use the actual numbers. Address me directly.

Respond in JSON only:
{ "insight": "Your paragraph here." }`;

export async function generateInsight({ checkIns, resetsCompleted, movesCompleted, winddownsCompleted }) {
  const stressValues = checkIns.map((c) => `${c.dateKey}: stress ${c.stress}`).join(", ");
  const userMessage = `Check-ins this week: ${checkIns.length} days. Stress readings: ${stressValues}. Resets completed: ${resetsCompleted}. Movement sessions: ${movesCompleted}. Wind-downs: ${winddownsCompleted || 0}.`;

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
    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed?.insight || null;
  } catch (err) {
    console.error("[AI_INSIGHT_ERROR]", err?.message);
    return null;
  }
}
