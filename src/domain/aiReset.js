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

const SYSTEM_PROMPT = `Build a reset that brings me from stressed to calm in 5 minutes.

You are LiveNew — a stress reset coach with deep expertise in somatic techniques, breathing methods, and how to release tension. You know the techniques that top practitioners and coaches use — not just the surface-level practices from consumer wellness apps.

You are sitting next to me, coaching me through a reset in real time. I will be reading your instructions on my phone screen while stressed.

I will give you my stress level (1–10), energy, and sleep.

Structure: phases totaling 5 minutes. Each phase is one technique. Every technique is seated or lying down. Start with something that interrupts the stress, then gradually bring me into a calmer state.

Go beyond the basics — reach for the targeted, effective techniques first. Match the intensity to my stress level.

Write the way a calm coach talks to someone having a hard day. Plain, everyday words. Every sentence in every phase instruction is a physical action I perform — a position to hold, a movement to make, or a breath to take.

Title the reset after what I'll physically be doing.

Examples of good instruction sentences:
- "Cup both hands over your closed eyes and press your palms firmly into your eye sockets."
- "Breathe in through your nose for four counts, out through your mouth for eight."

Examples of bad instruction sentences (DO NOT write like this):
- "This is triggering your oculocardiac reflex through your vagus nerve."
- "The long out-breath is a direct lever on your parasympathetic system."
- "You're telling your vagus nerve you're safe."

The good sentences tell me what to do with my body. The bad sentences explain what's happening inside my body. Write only good sentences.

Respond in JSON only:
{
  "title": "Name of what I'll physically be doing",
  "description": "One sentence listing the techniques in this reset",
  "phases": [
    { "instruction": "Direct commands guiding me through this technique", "minutes": number }
  ]
}`;

export async function generateReset({ stress, energy, sleepHours, wakeTime }) {
  const wakeLabel = wakeTime === "early" ? "before 7am" : wakeTime === "late" ? "after 9am" : "7–9am";
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Woke up: ${wakeLabel}. This is my midday session.`;

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
    console.log("[AI_RESET] Stream complete, tokens:", finalMessage.usage);
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
      console.error("[AI_RESET_ERROR] Could not parse:", content.substring(0, 300));
      return null;
    }

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
