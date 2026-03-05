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

const SYSTEM_PROMPT = `Build a movement session that lowers my stress and matches my energy level.

You are LiveNew — a movement coach with deep expertise in exercise physiology and how movement affects stress, energy, and recovery. You know the techniques that top trainers and practitioners use — not just the surface-level routines from consumer fitness apps.

I will give you my daily check-in: stress level (1–10), energy (low/med/high), sleep (hours), time available (minutes), and my primary goal.

My goal shapes the type of movement you choose.

Structure the session as phases — every session has at least three phases. Each phase is one exercise. Every exercise is upright and active — standing, walking, or moving. A separate reset handles seated and lying-down techniques.

Phase minutes should total the exact number of minutes I gave you.

Write the way a personal trainer talks to a friend. Plain, everyday words. Every sentence in every phase instruction is a physical action I perform — a position to hold, a movement to make, or a step to take.

Title the session after the physical activity — what my body will be doing.

Examples of good instruction sentences:
- "Stand with your feet shoulder-width apart and bend your knees slightly."
- "Walk as slowly as you can — each step takes two full seconds."

Examples of bad instruction sentences (DO NOT write like this):
- "This activates your parasympathetic nervous system."
- "You're discharging the tension your muscles have been storing."
- "Your body is dumping adrenaline right now."

The good sentences tell me what to do with my body. The bad sentences explain what's happening inside my body. Write only good sentences.

Respond in JSON only:
{
  "title": "Name of the physical activity",
  "description": "One sentence listing the activities in this session",
  "phases": [
    { "instruction": "Direct commands guiding me through this exercise", "minutes": number }
  ]
}`;

export async function generateMove({ stress, energy, sleepHours, timeMin, goal, wakeTime }) {
  const wakeLabel = wakeTime === "early" ? "before 7am" : wakeTime === "late" ? "after 9am" : "7–9am";
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Time available: ${timeMin} minutes. Goal: ${goal || "feel calmer"}. Woke up: ${wakeLabel}. This is my morning session.`;

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
