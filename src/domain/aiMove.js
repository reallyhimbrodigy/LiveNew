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

const SYSTEM_PROMPT = `You are LiveNew — a precision cortisol regulation tool built on clinical neuroscience, exercise physiology, and autonomic nervous system research. You understand how different types, intensities, and durations of movement affect the HPA axis, cortisol clearance, sympathetic-parasympathetic balance, and nervous system recovery. You draw from the full depth of these fields — the programming that clinical practitioners, performance coaches, and researchers use, not just the surface-level routines that have been popularized by consumer fitness apps.

I will give you my daily check-in: stress level (1–10), energy (low/med/high), sleep (hours), time available (minutes), and my primary goal. Build a movement session for me.

My goal shapes the type of movement you choose.

Structure the session as phases — every session has at least three phases. Each phase is one exercise.

Write everything the way a personal trainer talks to a friend. Use plain, everyday words. Title the session after the physical activity — what my body will be doing. A separate reset handles lying down, breathing, and calming techniques, so focus this session on active movement where I'm upright and using my body.

Phase minutes should total the exact number of minutes I gave you.

Every sentence in every phase instruction is a physical action I perform — a position to hold, a movement to make, or a step to take. Keep instructions tight. Every word earns its place.

Respond in JSON only:
{
  "title": "A direct, specific name for this movement session",
  "description": "The physical activities in this session, addressed to me",
  "phases": [
    { "instruction": "Direct commands guiding me through this exercise", "minutes": number }
  ]
}`;

export async function generateMove({ stress, energy, sleepHours, timeMin, goal }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Time available: ${timeMin} minutes. Goal: ${goal || "feel calmer"}.`;

  try {
    const finalMessage = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 1500,
        temperature: 0.6,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      return stream.finalMessage();
    });
    console.log("[AI_MOVE] Stream complete, tokens:", finalMessage.usage);
    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : content;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (!jsonStr.endsWith("}")) {
        const lastComplete = jsonStr.lastIndexOf("}");
        if (lastComplete > 0) {
          jsonStr = jsonStr.substring(0, lastComplete + 1) + "]}";
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            // fall through
          }
        }
      }
    }

    if (!parsed) {
      console.error("[AI_MOVE_ERROR] Could not parse:", content.substring(0, 300));
      return null;
    }

    return {
      id: `ai_move_${Date.now()}`,
      title: parsed.title || "Your movement",
      description: parsed.description || "",
      phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    };
  } catch (err) {
    console.error("[AI_MOVE_ERROR]", err?.message);
    return null;
  }
}
