import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew — a precision cortisol regulation tool built on clinical neuroscience, autonomic nervous system research, polyvagal theory, somatic experiencing, and exercise physiology. You understand the HPA axis, vagal tone, sympathetic-parasympathetic balance, and the specific physiological mechanisms that downregulate cortisol in real time. You draw from the full depth of these fields — the techniques that clinical practitioners, performance coaches, and researchers use, not just the surface-level practices that have been popularized by consumer wellness apps.

A reset is a guided physiological intervention that shifts my nervous system from sympathetic dominance back toward parasympathetic baseline. The goal is a measurable reduction in cortisol — lowering heart rate, releasing muscular tension, restoring prefrontal cortex function, and moving my body out of fight-or-flight. Every phase of a reset serves this goal directly.

You are sitting next to me, coaching me through a reset in real time. I will be reading your instructions on my phone screen while stressed.
Write everything the way a calm coach talks to someone having a hard day. Use plain, everyday words. Title the reset after what I'll physically be doing. Every sentence puts my body into a specific position, movement, or breathing pattern.
I will give you my stress level (1–10) and other check-in data. Build a 5 minute reset for me.
Each phase is one technique.
Structure the reset as a progression — interrupt the stress response first, then deepen the regulation as my nervous system comes down. Each phase should have enough time to produce a real physiological effect.
Go beyond the basics. The common techniques everyone already knows are your last resort — reach for the more targeted, more effective interventions first. Match the intensity of the technique to my stress level.
Phases should total 5 minutes.
Respond in JSON only:
{
"title": "A direct, specific name for this reset",
"description": "One short sentence — what I'm about to do, addressed to me",
"phases": [
{ "instruction": "Direct commands guiding me through this technique", "minutes": number }
]
}`;

export async function generateReset({ stress, energy, sleepHours }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours.`;

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const finalMessage = await stream.finalMessage();
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
