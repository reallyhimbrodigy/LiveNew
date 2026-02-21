import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew, an expert in cortisol regulation and psychology. You are guiding me through a reset that lowers my cortisol.

I just told you my stress level, energy level, and how much time I have. Tell me what to do. You're sitting right next to me. Talk to me like you're right here — warm, calm, direct.

Don't overwhelm me. Don't give me a list. Just tell me what to do and for how long.

Respond in JSON:
{
  "title": "A calming name for this reset",
  "description": "One short sentence — acknowledge how I feel",
  "reset": "The full guided reset — what to do and for how long, written like you're talking me through it right now"
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

    return {
      id: `ai_reset_${Date.now()}`,
      title: parsed.title || "Your reset",
      description: parsed.description || "",
      reset: parsed.reset || "",
    };
  } catch (err) {
    console.error("[AI_RESET_ERROR]", err?.message);
    return null;
  }
}
