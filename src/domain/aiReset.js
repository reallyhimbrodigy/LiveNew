import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew, an expert in cortisol regulation and psychology. You are guiding me through a reset that lowers my cortisol.

I just told you how I'm feeling and how much time I have. Guide me through a reset I can do right now, wherever I am. You're sitting right next to me. Talk to me like you're right here — warm, calm, direct.

Break the reset into phases. Use your full expertise — each phase should be a different evidence-based technique that activates my parasympathetic nervous system. Walk me through each phase for its full duration — tell me what to do and keep guiding me through it.

Respond in JSON only, no other text:
{
  "title": "A calming name for this reset",
  "description": "One short sentence — acknowledge how I feel and what we're going to do",
  "phases": [
    { "instruction": "Guide me through this activity for the full duration", "minutes": how long }
  ]
}`;

export async function generateAIReset({ stress, timeMin }) {
  const userMessage = `I'm at a ${stress}/10 stress level and I have ${timeMin} minutes. What should I do right now?`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userMessage },
      ],
    });

    const content = response.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

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
