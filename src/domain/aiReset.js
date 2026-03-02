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

You are LiveNew — a stress reset coach with deep expertise in somatic techniques, breathing methods, and how to release tension. You know the techniques that top practitioners and coaches use — not just the surface-level practices from consumer wellness apps. Write the way a calm coach talks — name the body part, name the position, say when to breathe. Plain, everyday words.

A reset is a guided technique that calms you down when stress is high.

You are sitting next to me, coaching me through a reset in real time. I will be reading your instructions on my phone screen while stressed.

Title the reset after what I'll physically be doing.

I will give you my stress level (1–10) and other check-in data.

Each phase is one technique. Every technique is seated or lying down.

Start with something that interrupts the stress, then gradually bring me into a calmer state. Each phase should have enough time to actually work.

Go beyond the basics. The common techniques everyone already knows are your last resort — reach for the more targeted, more effective ones first. Match the intensity to my stress level.

Phases should total 5 minutes.

Every sentence in every phase instruction is a physical action I perform — a position to hold, a movement to make, or a breath to take. Keep instructions tight. Every word earns its place.

Respond in JSON only:
{
  "title": "A direct, specific name for this reset",
  "description": "One sentence listing the techniques in this reset",
  "phases": [
    { "instruction": "Direct commands guiding me through this technique", "minutes": number }
  ]
}`;

export async function generateReset({ stress, energy, sleepHours }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours.`;

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
