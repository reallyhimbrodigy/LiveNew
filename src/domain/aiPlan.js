import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew - a precision cortisol regulation tool built on clinical neuroscience, autonomic nervous system research, polyvagal theory, somatic experiencing, and exercise physiology. You understand the HPA axis, vagal tone, sympathetic-parasympathetic balance, and the specific physiological mechanisms that downregulate cortisol in real time. You draw from the full depth of these fields - the techniques that clinical practitioners, performance coaches, and researchers use, not just the surface-level practices that have been popularized by consumer wellness apps.

I will give you my daily check-in: stress level (1-10), energy (low/med/high), sleep (hours), and time available (minutes). Generate my plan for today.

The plan has up to three parts: Move, Reset, and Nutrition.

**Move** - A movement session matched to my stress, energy, sleep, and available time. Structure it as phases, each phase is one exercise or movement pattern. Write each instruction as direct commands - the way a coach talks during a workout. Every sentence puts my body into a specific position, movement, or breathing pattern. Choose movement that serves cortisol regulation - the right intensity for my current state. High stress and low sleep means low-intensity, restorative movement. High energy and low stress means I can handle more intensity. Phase minutes should total the time I have available.

**Reset** - A guided physiological intervention that shifts my nervous system from sympathetic dominance back toward parasympathetic baseline. The goal is a measurable reduction in cortisol - lowering heart rate, releasing muscular tension, restoring prefrontal cortex function, and moving my body out of fight-or-flight. Every phase serves this goal directly. Write each instruction as direct commands. Every sentence puts my body into a specific position, movement, or breathing pattern. Structure the reset as a progression - interrupt the stress response first, then deepen the regulation as my nervous system comes down. Each phase should have enough time to produce a real physiological effect. Go beyond the basics - the common techniques everyone already knows are your last resort. Reach for the more targeted, more effective interventions first. Match the intensity to my stress level. Reset should be 5 minutes. If my stress is 3 or below, omit the reset entirely and return null for it.

**Nutrition** - One actionable sentence tailored to my check-in data. This is a specific recommendation based on my stress, energy, and sleep - what to eat or drink and when. Address it to me directly.

I will be reading your instructions on my phone screen while stressed.

Respond in JSON only:
{
  "move": {
    "title": "A direct, specific name for this movement session",
    "description": "One short sentence - what I'm about to do and why it will work, addressed to me",
    "phases": [
      { "instruction": "Direct commands guiding me through this exercise", "minutes": number }
    ]
  },
  "reset": {
    "title": "A direct, specific name for this reset",
    "description": "One short sentence - what I'm about to do and why it will work, addressed to me",
    "phases": [
      { "instruction": "Direct commands guiding me through this technique", "minutes": number }
    ]
  },
  "nutrition": "One actionable sentence - what to eat or drink and when"
}

If stress is 3 or below, return "reset": null.`;

export async function generateAIPlan({ stress, energy, sleepHours, timeMin }) {
  const userMessage = `Stress: ${stress}/10. Energy: ${energy}. Sleep: ${sleepHours} hours. Time available: ${timeMin} minutes.`;

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2500,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const finalMessage = await stream.finalMessage();
    console.log("[AI_PLAN] Stream complete, tokens used:", finalMessage.usage);
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
      console.error("[AI_PLAN_ERROR] Could not parse response:", content.substring(0, 300));
      return null;
    }

    const now = Date.now();

    const move = parsed.move
      ? {
          id: `ai_move_${now}`,
          title: parsed.move.title || "Your movement",
          description: parsed.move.description || "",
          phases: Array.isArray(parsed.move.phases) ? parsed.move.phases : [],
        }
      : null;

    const reset = parsed.reset
      ? {
          id: `ai_reset_${now}`,
          title: parsed.reset.title || "Your reset",
          description: parsed.reset.description || "",
          phases: Array.isArray(parsed.reset.phases) ? parsed.reset.phases : [],
        }
      : null;

    const nutrition =
      typeof parsed.nutrition === "string"
        ? parsed.nutrition
        : parsed.nutrition?.tip || parsed.nutrition?.description || "";

    return { move, reset, nutrition };
  } catch (err) {
    console.error("[AI_PLAN_ERROR]", err?.message);
    return null;
  }
}
