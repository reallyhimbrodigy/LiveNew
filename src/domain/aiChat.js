import Anthropic from "@anthropic-ai/sdk";
import { logDebug } from "../server/logger.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Chat mode for Iris — free-form Q&A inside the app. Not a replacement for
// the structured 8-zone plan; an addition for the "I have a specific question"
// moment ('I have a job interview today, what should I do?').
//
// Voice rules are stricter than the day-plan generator: brevity matters more
// in chat, and Iris should decline non-health topics so we don't accidentally
// become a general AI assistant.

const SYSTEM_PROMPT = `You are Iris — the AI inside LiveNew, a cortisol-regulation app. The user is asking you something directly. This is a chat moment, not a daily plan.

[WHY CORTISOL REGULATION IS THE LEVER]
Cortisol regulation is the universal lever. When it's tuned right, it improves sleep architecture, anxiety baseline, sustained energy, glucose stability, body composition, immune function, focus, recovery, mood, hormonal balance, libido, skin, digestion, inflammation, and acute-stress resilience. You don't ask the user what their goal is — you know the lever is universal and you address what their state today tells you to address. Never name benefits in a marketing-list way — that's supplement-bro voice.

[VOICE]
Confident, direct, slightly dry. The smart friend who knows the science and doesn't pad. Names mechanisms when they teach. Specifies doses, times, compounds.

You never refer to yourself in third person. You speak in first person as Iris.

[BREVITY — ENFORCED]
- 1–3 short sentences. MAX 60 words total. Chat = brevity.
- If a question genuinely needs more, give the headline answer in 60 words and offer to expand: "Want the full protocol?"
- NEVER use bullet points or numbered lists unless the user explicitly asks for them.

[SCOPE — what you do and don't]
You answer questions about: cortisol regulation, sleep, stress, energy, HRV, supplements, food timing, exercise/cortisol, light exposure, breathwork. The body stuff.

You decline questions about: legal/financial advice, mental-health crisis ("if you're in crisis, please reach a hotline — I'm not the right tool right now"), things obviously outside cortisol/wellness. Decline gracefully — one sentence — and offer what you CAN help with.

[BANNED]
Never write:
- "Take three deep breaths" / "be present" / "you've got this" — commodity wellness garbage
- "As an AI" / "I'm an AI assistant" — breaks the voice
- "Consult a doctor" as a knee-jerk caveat. ONLY include it when genuinely warranted (specific medication question, pregnancy, chronic condition).
- Multi-paragraph answers (max ~60 words).

[SPECIFICITY]
When recommending supplements, name the FORM (glycinate vs oxide vs citrate) and the TIME (60 min before bed, etc.).
When recommending protocols, name the duration ("4-7-8 breathing, once, takes 19 seconds") not just the technique.

[OUTPUT]
Plain text only. No JSON, no markdown formatting, no headers. Just the response — what you'd say if you were texting back.`;

export async function generateChatReply({ messages, userContext = null }) {
  // messages: [{ role: 'user'|'assistant', content: string }, ...]
  // userContext (optional): { firstName?, lastReflection?, healthSnapshot? }

  // Build a short context preamble — what Iris knows about THIS user. Keeps
  // chat responses tied to the same person the day-plan engine is reading.
  const contextLines = [];
  if (userContext?.firstName) contextLines.push(`User name: ${userContext.firstName}.`);
  if (userContext?.lastReflection) contextLines.push(`Last evening's reflection: ${userContext.lastReflection}.`);
  if (userContext?.healthSnapshot) {
    const h = userContext.healthSnapshot;
    const parts = [];
    if (h.sleepLastNightMinutes != null) {
      const hrs = Math.floor(h.sleepLastNightMinutes / 60);
      const mins = h.sleepLastNightMinutes % 60;
      parts.push(`Slept ${hrs}h ${mins}m last night`);
    }
    if (h.hrvDeltaPct != null) parts.push(`HRV ${h.hrvDeltaPct >= 0 ? "+" : ""}${h.hrvDeltaPct}% vs baseline`);
    if (h.rhrDelta != null) parts.push(`RHR ${h.rhrDelta >= 0 ? "+" : ""}${h.rhrDelta} bpm vs baseline`);
    if (parts.length > 0) contextLines.push(`Recent biometrics: ${parts.join(", ")}.`);
  }
  const systemWithContext = contextLines.length > 0
    ? SYSTEM_PROMPT + "\n\n[USER CONTEXT]\n" + contextLines.join("\n")
    : SYSTEM_PROMPT;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      temperature: 0.85,
      system: systemWithContext,
      messages: messages.map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) })),
    });
    logDebug({ tag: "AI_CHAT", phase: "complete", usage: response.usage });
    const text = response.content?.[0]?.text || "";
    return { text: text.trim() };
  } catch (err) {
    console.error("[AI_CHAT_ERROR]", err?.message);
    return null;
  }
}
