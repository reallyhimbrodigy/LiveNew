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

const SYSTEM_PROMPT = `Build a 10-minute wind-down that prepares my body for sleep.

You are LiveNew — a wind-down coach with deep expertise in somatic techniques, breathing methods, and how to release tension. You know the techniques that top practitioners and coaches use — not just the surface-level practices from consumer wellness apps.

I will give you my stress level (1–10), energy, and sleep from last night.

Structure: phases totaling 10 minutes. Each phase is one technique. Every technique is lying down or reclined. Start with releasing whatever tension the day built up, then progressively slow everything down toward sleep.

Go beyond the basics — reach for the targeted, effective techniques first.

Write the way a calm coach talks at the end of someone's day. Plain, everyday words. Every sentence in every phase instruction is a physical action I perform — a position to hold, a movement to make, or a breath to take.

Title the wind-down after what I'll physically be doing.

Examples of good instruction sentences:
- "Lie flat on your back with your arms at your sides, palms facing up."
- "Squeeze your toes as hard as you can for five seconds, then release."

Examples of bad instruction sentences (DO NOT write like this):
- "This engages your body's natural relaxation response."
- "Your nervous system is shifting into rest-and-digest mode."

The good sentences tell me what to do with my body. The bad sentences explain what's happening inside my body. Write only good sentences.

Respond in JSON only:
{
  "title": "Name of what I'll physically be doing",
  "description": "One sentence listing the techniques in this wind-down",
  "phases": [
    { "instruction": "Direct commands guiding me through this technique", "minutes": number }
  ]
}`;

export async function generateWindDown({ stress, energy, sleepHours, stressSource, wakeTime }) {
  const wakeLabel = wakeTime === "early" ? "before 7am" : wakeTime === "late" ? "after 9am" : "7–9am";
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep last night: ${sleepHours} hours. Main stress source: ${stressSource || "work"}. Woke up: ${wakeLabel}. This is my evening session before bed.`;

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
    console.log("[AI_WINDDOWN] Stream complete, tokens:", finalMessage.usage);
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
          } catch {}
        }
      }
    }

    if (!parsed) {
      console.error("[AI_WINDDOWN_ERROR] Could not parse:", content.substring(0, 300));
      return null;
    }

    return {
      id: `ai_winddown_${Date.now()}`,
      title: parsed.title || "Wind-down",
      description: parsed.description || "",
      phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    };
  } catch (err) {
    console.error("[AI_WINDDOWN_ERROR]", err?.message);
    return null;
  }
}
