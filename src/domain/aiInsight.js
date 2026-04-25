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

const SYSTEM_PROMPT = `You are LiveNew. I'll give you a user's last week of stress check-ins and how many plan items they internalized.

Write ONE sentence. Maybe a second short sentence if it adds something a coach would actually say. Never more.

What good looks like:
"Stress dropped from 7 to 5 — the morning sunlight is doing its job."
"You showed up 6 of 7 days. That's the part that compounds."
"Stress is sticking at 8. Pick one thing and make it non-negotiable this week."

What bad looks like:
- Multi-clause openers ("You checked in 6 of 7 days, which shows real commitment to paying attention…")
- Numbers stacked into a paragraph
- Recommendations that hedge ("try to maybe consider…")
- Generic AI fluff. No "embrace the journey." No "be kind to yourself." No "remember to listen to your body." No "you've got this." Speak like a real person who's actually looked at the data.

Respond JSON only: { "insight": "..." }`;

export async function generateInsight({ checkIns, doneCount }) {
  const stressLine = checkIns
    .filter((c) => c.stress != null)
    .map((c) => `${c.dateKey}:${c.stress}`)
    .join(" ");
  const userMessage = `Days checked in: ${checkIns.length}. Stress per day: ${stressLine}. Plan items they internalized this week: ${doneCount}.`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 200,
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
