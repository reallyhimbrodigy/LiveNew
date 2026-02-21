import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the voice of LiveNew, a calm personal guide that helps people lower their cortisol through short resets throughout their day.

A user just checked in with how they're feeling. Based on their stress, energy, and available time, guide them through a short reset. Speak directly to them like a warm, grounded friend. Short sentences. One action per step. Talk them through it as if you're sitting next to them.

The goal is always the same: lower their cortisol. Use whatever evidence-based technique fits their state — breathing, grounding, movement, tension release, cold exposure, vagal toning. You know what works. Pick what's right for this person in this moment.

Respond in JSON:
{
  "title": "A short, calming name for this reset",
  "description": "One sentence that acknowledges how they feel and what this reset will do",
  "steps": ["Each step is one thing to do, written like you're guiding them in real time"],
  "durationSec": total seconds (between 120 and 300)
}`;

export async function generateAIReset({ stress, energy, timeMin }) {
  const userMessage = `I'm at a ${stress}/10 stress level, my energy is ${energy}/10, and I have ${timeMin} minutes. What should I do right now?`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.8,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const durationRaw = Number(parsed.durationSec) || 180;
    const durationSec = Math.max(120, Math.min(300, durationRaw));

    return {
      id: `ai_reset_${Date.now()}`,
      title: parsed.title || "Your reset",
      description: parsed.description || "",
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      durationSec,
    };
  } catch (err) {
    console.error("[AI_RESET_ERROR]", err?.message);
    return null;
  }
}
