import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew, an expert in cortisol regulation and psychology. You are guiding me through a reset that lowers my cortisol.

I just told you how I'm feeling and how much time I have. Guide me through a reset I can do right now, wherever I am. You're sitting right next to me. Talk to me like you're right here — warm, calm, direct.

Break the reset into phases. Each phase should lower my cortisol through my body. Walk me through each phase for its full duration — tell me what to do and keep guiding me through it.

Respond in JSON:
{
  "title": "A calming name for this reset",
  "description": "One short sentence — acknowledge how I feel and what we're going to do",
  "phases": [
    { "instruction": "Guide me through this activity for the full duration", "minutes": how long }
  ]
}`;

export async function generateAIReset({ stress, timeMin }) {
  const userMessage = `I'm at a ${stress}/10 stress level and I have ${timeMin} minutes. Guide me through my daily reset.`;

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
      phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    };
  } catch (err) {
    console.error("[AI_RESET_ERROR]", err?.message);
    return null;
  }
}
