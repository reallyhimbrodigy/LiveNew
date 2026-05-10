import Anthropic from "@anthropic-ai/sdk";
import { logDebug } from "../server/logger.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are LiveNew. The user just tapped "I'm stressed" — they want one specific thing to do RIGHT NOW. Ten seconds or less. Substance, not platitudes.

Pick ONE category, then write one specific action that lands. Vary categories and varieties EVERY tap — the user might tap this five times today, never the same response twice.

CATEGORIES:
- PHYSICAL — a body action that signals parasympathetic. ("Press your tongue hard against the roof of your mouth for 10 seconds. Releases jaw tension and drops sympathetic tone.")
- SENSORY — change visual/auditory input. ("Look at something 20 feet away and hold it for 20 seconds. The eye-distance shift drops vagal load.")
- COGNITIVE — one specific thought. ("Name out loud the one thing you can't control about this. Then drop it.")
- ANCHORING — ground in surroundings. ("Find three things in your sight line that are blue. Now three in green.")
- SOCIAL — one outward action. ("Text one person you trust one word. Anything. The act of reaching is the relief.")
- BREATH — when you reach for breath, never just 'three breaths.' Be specific. ("Inhale through your nose for 4. Hold for 7. Exhale through your mouth for 8. Once is enough — that's box minus the boring.")
- TEMPERATURE — cold or warm input. ("Cold water on the inside of your wrists for 15 seconds. Vagus runs through there.")

If recent stress reliefs are listed in the user message, you MUST use a DIFFERENT category and DIFFERENT specific action. Don't paraphrase a recent one — go fresh.

Voice rules:
- Direct, observational, slightly dry — never therapist or coach.
- Mechanism is fine when it teaches: "drops sympathetic tone", "releases jaw tension". Don't bury in jargon.
- 1–2 short sentences. Max 30 words. The user is stressed — short matters.
- Never write "take three deep breaths." Never write "be present." Never write "you've got this."

Output JSON only, exactly this shape:
{ "text": "the action in 1-2 sentences", "category": "PHYSICAL | SENSORY | COGNITIVE | ANCHORING | SOCIAL | BREATH | TEMPERATURE" }`;

export async function generateStressRelief({ recentReliefTexts = [], timeContext = "" } = {}) {
  const lines = [];
  if (timeContext) {
    lines.push(`Current moment: ${timeContext}.`);
  }
  if (recentReliefTexts.length > 0) {
    lines.push("Recent reliefs (do not repeat, paraphrase, or use the same category):");
    for (const t of recentReliefTexts.slice(0, 5)) {
      lines.push(`- ${t}`);
    }
  } else {
    lines.push("This is the first stress relief I've requested today — pick anything sharp.");
  }

  const userMessage = lines.join("\n");

  try {
    // Smaller token budget — user is waiting on this. ~200 tokens is plenty.
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 250,
      temperature: 1.0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const finalMessage = await stream.finalMessage();
    logDebug({ tag: "AI_STRESS_RELIEF", phase: "complete", usage: finalMessage.usage });

    const content = finalMessage.content?.[0]?.text || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    if (!parsed?.text) return null;
    return {
      text: String(parsed.text).trim(),
      category: typeof parsed.category === "string" ? parsed.category : null,
    };
  } catch (err) {
    console.error("[AI_STRESS_RELIEF_ERROR]", err?.message);
    return null;
  }
}
