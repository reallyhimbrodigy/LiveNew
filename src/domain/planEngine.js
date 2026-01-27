import { computeCortisolLoad, loadBand } from "./scoring.js";
import { isTimeAfter } from "./time.js";

const uid = () => Math.random().toString(36).slice(2);

function block(
  window,
  title,
  minutes,
  instructions,
  tags
) {
  return { id: uid(), window, title, minutes, instructions, tags };
}

export function generateWeekPlan(baseline, startDateISO) {
  const baseLoad = computeCortisolLoad(baseline);
  const band = loadBand(baseLoad);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(startDateISO, i);
    const day = generateDayPlan(baseline, dateISO, band);
    days.push(day);
  }

  return {
    startDateISO,
    days,
    version: 2,
  };
}

function generateDayPlan(b, dateISO, band) {
  const time = b.constraints.timePerDayMin;

  const focus =
    band === "high" ? "downshift" : band === "medium" ? "stabilize" : "rebuild";

  const morning = Math.max(3, Math.round(time * (focus === "downshift" ? 0.3 : 0.25)));
  const midday = Math.max(3, Math.round(time * (focus === "downshift" ? 0.15 : 0.2)));
  const evening = Math.max(4, Math.round(time * (focus === "downshift" ? 0.3 : 0.35)));
  const night = Math.max(focus === "downshift" ? 5 : 3, time - (morning + midday + evening));

  const blocks = [];

  blocks.push(
    block(
      "AM",
      "Morning downshift",
      morning,
      [
        "Get outside light for 5–10 minutes within 60 minutes of waking.",
        "Do 3 minutes: inhale 4s, exhale 6s (nasal if possible).",
        "Hydrate before caffeine. Delay caffeine 60–90 minutes if feasible.",
      ],
      ["light", "breath", "recovery"]
    )
  );

  blocks.push(
    block(
      "MIDDAY",
      "Midday stabilize",
      midday,
      [
        "5–10 minutes easy walk or mobility (keep it under a 6/10 effort).",
        "Eat a balanced meal: protein + fiber + carbs matched to activity.",
        "Avoid high-sugar solo snacks; pair carbs with protein/fat.",
      ],
      ["movement", "food", "recovery"]
    )
  );

  if (band === "high") {
    blocks.push(
      block(
        "PM",
        "Evening nervous-system reset",
        evening,
        [
          "Choose low-intensity movement: walk, yoga, or zone-2 easy pace.",
          "Finish with 5 minutes slow breathing or legs-up-the-wall.",
          "Keep screens dim in the last hour if possible.",
        ],
        ["movement", "breath", "sleep", "recovery"]
      )
    );
  } else if (band === "medium") {
    blocks.push(
      block(
        "PM",
        "Evening stabilize + strength",
        evening,
        [
          "Do 15–25 minutes strength (submax, stop 2 reps before failure).",
          "Cooldown: 3 minutes long exhale breathing.",
          "Dinner: protein-forward; limit alcohol and late heavy meals.",
        ],
        ["movement", "breath", "food", "sleep"]
      )
    );
  } else {
    blocks.push(
      block(
        "PM",
        "Rebuild capacity",
        evening,
        [
          "Strength or intervals 20–35 minutes (only if recovery is good).",
          "Cooldown: walk 5 minutes.",
          "Carbs near training if desired; prioritize sleep consistency.",
        ],
        ["movement", "food", "sleep"]
      )
    );
  }

  const nightInstructions = [
    "Set a wind-down anchor: same 20–30 minute routine nightly.",
    "No doom-scrolling in bed; keep lights low.",
    "If racing thoughts: write 3 bullets (tomorrow plan, worries, one win).",
  ];
  nightInstructions.push(
    isTimeAfter(b.bedtime, "23:30")
      ? "Move bedtime 15 minutes earlier tonight if possible."
      : "Protect your current bedtime window."
  );

  blocks.push(block("NIGHT", "Sleep gate", night, nightInstructions, ["sleep", "recovery"]));

  return { dateISO, blocks, focus };
}

function addDaysISO(startISO, days) {
  const d = new Date(`${startISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
