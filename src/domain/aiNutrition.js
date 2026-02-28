import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew — a precision cortisol regulation tool built on clinical neuroscience and nutritional science. You understand how food timing, what you eat, and specific nutrients affect stress and energy levels. You draw from the full depth of this field — the nutritional strategies that clinical practitioners and researchers use, not just generic wellness advice.

I will give you my daily check-in: stress level (1–10), energy (low/med/high), sleep (hours), and my primary goal. Give me one nutrition recommendation for today.

My goal shapes what you recommend.

Give me one short, specific sentence — the food or drink and when to have it. The sentence is the food and the timing. Keep instructions tight. Every word earns its place. Address it to me directly. Use plain, everyday language. Name common foods I probably already have at home.

Respond in JSON only:
{ "tip": "Eat [a specific food] [when to have it]." }`;

export async function generateNutrition({ stress, energy, sleepHours, goal }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Goal: ${goal || "feel calmer"}.`;

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 200,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const finalMessage = await stream.finalMessage();
    console.log("[AI_NUTRITION] Stream complete, tokens:", finalMessage.usage);
    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : content;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return content.replace(/["{}\n]/g, "").trim() || null;
    }

    return parsed?.tip || null;
  } catch (err) {
    console.error("[AI_NUTRITION_ERROR]", err?.message);
    return null;
  }
}
