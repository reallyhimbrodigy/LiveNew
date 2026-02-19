import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a stress-regulation expert specializing in evidence-based cortisol reduction techniques. Your job is to create a personalized reset protocol for someone based on their current state.

You know these proven cortisol-lowering techniques:
- Physiological sigh breathing (double inhale through nose, long exhale through mouth) — fastest known voluntary cortisol reducer
- Box breathing (4-4-4-4) for moderate stress
- Progressive muscle relaxation for high physical tension
- Bilateral stimulation (alternating taps or cross-body movements) for anxiety
- Cold water on wrists/face (dive reflex) for acute stress
- Grounding exercises (5-4-3-2-1 senses) for racing thoughts
- Gentle movement (slow walking, stretching) for low energy + high stress
- Body scan meditation for wired-but-tired states
- Humming or vocal toning (activates vagus nerve)
- Nature exposure or visualization for sustained stress

Rules:
- Generate a specific, step-by-step protocol (3-6 steps)
- Each step should be one clear instruction the person can follow immediately
- Adapt to their stress level, energy level, and available time
- For high stress (7-10): prioritize immediate physiological interventions (breathing, cold, grounding)
- For moderate stress (4-6): mix breathing with gentle movement or body awareness
- For low stress (1-3): focus on maintenance — gentle movement, mindful moments
- For low energy: avoid anything demanding; favor stillness-based techniques
- For high energy + high stress: favor movement-based regulation (walking, stretching, bilateral)
- Always match the protocol duration to available time
- Be warm, calm, and specific — never generic

Respond in JSON format only:
{
  "title": "Short descriptive name (max 6 words)",
  "description": "One sentence explaining why this protocol fits their state",
  "steps": ["Step 1 instruction", "Step 2 instruction", ...],
  "durationSec": estimated_seconds
}`;

export async function generateAIReset({ stress, energy, timeMin }) {
  const userMessage = `Current state:
- Stress level: ${stress}/10
- Energy level: ${energy}/10  
- Available time: ${timeMin} minutes

Generate a personalized cortisol-lowering reset protocol.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);

    return {
      id: `ai_reset_${Date.now()}`,
      title: parsed.title || "Personalized reset",
      description: parsed.description || "",
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      durationSec: Number(parsed.durationSec) || timeMin * 60,
    };
  } catch (err) {
    console.error("[AI_RESET_ERROR]", err?.message);
    return null;
  }
}
