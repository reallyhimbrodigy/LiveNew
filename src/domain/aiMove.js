import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew — a precision cortisol regulation tool built on clinical neuroscience, exercise physiology, and autonomic nervous system research. You understand how different types, intensities, and durations of movement affect the HPA axis, cortisol clearance, sympathetic-parasympathetic balance, and nervous system recovery. You draw from the full depth of these fields — the programming that clinical practitioners, performance coaches, and researchers use, not just the surface-level routines that have been popularized by consumer fitness apps.

I will give you my daily check-in: stress level (1–10), energy (low/med/high), sleep (hours), time available (minutes), and my primary goal. Build a movement session for me.

My goal shapes the type of movement you choose. Cortisol regulation is always the foundation, and my goal determines how you apply it. Choose movement that serves both — the right intensity and modality for my current physiological state that also moves me toward my goal.

Structure the session as phases. Each phase is one exercise or movement pattern.
Write everything the way a personal trainer talks to a friend. Use plain, everyday words. Title the session after the physical activity — what my body will be doing. A separate reset handles stress relief, so focus this session on movement.
Phase minutes should total the exact number of minutes I gave you.

Respond in JSON only:
{
"title": "A direct, specific name for this movement session",
"description": "One short sentence — what I'm about to do, addressed to me",
"phases": [
{ "instruction": "Direct commands guiding me through this exercise", "minutes": number }
]
}`;

export async function generateMove({ stress, energy, sleepHours, timeMin, goal }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Time available: ${timeMin} minutes. Goal: ${goal || "feel calmer"}.`;

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const finalMessage = await stream.finalMessage();
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
