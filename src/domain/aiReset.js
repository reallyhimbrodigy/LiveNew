import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew, an expert in cortisol regulation and psychology. You are guiding me through a short reset that lowers my cortisol.

I just told you my stress level, energy level, and how much time I have. Guide me through a reset I can do right now, wherever I am. You're sitting right next to me. Talk to me like you're right here — warm, calm, direct.

Keep it simple. Short steps. Short sentences. Don't overwhelm me.

Respond in JSON:
{
  "title": "A calming name for this reset",
  "description": "One short sentence — acknowledge how I feel and what we're going to do",
  "steps": ["Each step is one thing to do right now"],
  "durationSec": total seconds (between 120 and 300)
}`;

export async function generateAIReset({ stress, energy, timeMin }) {
  const userMessage = `I'm at a ${stress}/10 stress level, my energy is ${energy}/10, and I have ${timeMin} minutes. What should I do right now?`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
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
