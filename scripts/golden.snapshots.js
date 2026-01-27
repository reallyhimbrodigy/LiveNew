import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const GOLDEN_DIR = path.join(ROOT, "test", "golden");
const SCENARIOS_PATH = path.join(GOLDEN_DIR, "scenarios.json");
const DRIFT_REPORT_PATH = path.join(GOLDEN_DIR, "drift-report.json");
const DATA_DIR = path.join(ROOT, "data", "test-golden");

const DEFAULT_FLAGS = {
  "rules.constraints.enabled": "true",
  "rules.novelty.enabled": "true",
  "rules.feedback.enabled": "true",
  "rules.badDay.enabled": "true",
  "rules.recoveryDebt.enabled": "true",
  "rules.circadianAnchors.enabled": "true",
  "rules.safety.enabled": "true",
};

function stableStringify(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${parts.join(",")}}`;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function roundNumber(value, places = 4) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function normalizeDayContract(day) {
  const next = JSON.parse(JSON.stringify(day));
  if (next?.why?.meta?.generatedAtISO) {
    delete next.why.meta.generatedAtISO;
  }
  if (next?.why?.checkInPrompt) {
    delete next.why.checkInPrompt;
  }
  const packScore = next?.why?.packMatch?.score;
  if (Number.isFinite(packScore)) {
    next.why.packMatch.score = roundNumber(packScore);
  }
  if (Number.isFinite(next?.why?.confidence)) {
    next.why.confidence = roundNumber(next.why.confidence);
  }
  if (Number.isFinite(next?.why?.relevance)) {
    next.why.relevance = roundNumber(next.why.relevance);
  }
  if (Number.isFinite(next?.why?.meta?.confidence)) {
    next.why.meta.confidence = roundNumber(next.why.meta.confidence);
  }
  if (Number.isFinite(next?.why?.meta?.relevance)) {
    next.why.meta.relevance = roundNumber(next.why.meta.relevance);
  }
  if (Number.isFinite(next?.why?.meta?.packMatch?.score)) {
    next.why.meta.packMatch.score = roundNumber(next.why.meta.packMatch.score);
  }
  return next;
}

function keyFieldsFromDay(day) {
  return {
    profile: day?.why?.profile || null,
    focus: day?.why?.focus || null,
    workoutId: day?.what?.workout?.id || null,
    resetId: day?.what?.reset?.id || null,
    nutritionId: day?.what?.nutrition?.id || null,
    totalMinutes: day?.howLong?.totalMinutes ?? null,
  };
}

function normalizeProfile(profile, packId, tz) {
  const base = {
    wakeTime: "07:00",
    bedTime: "23:00",
    sleepRegularity: 5,
    caffeineCupsPerDay: 1,
    lateCaffeineDaysPerWeek: 1,
    sunlightMinutesPerDay: 10,
    lateScreenMinutesPerNight: 45,
    alcoholNightsPerWeek: 1,
    mealTimingConsistency: 5,
    preferredWorkoutWindows: ["PM"],
    busyDays: [],
    timezone: tz,
    dayBoundaryHour: 4,
    contentPack: packId,
  };
  return { ...base, ...(profile || {}), timezone: tz, contentPack: packId };
}

function defaultPackSeeds(defaults) {
  const weights = defaults.contentPackWeights || {};
  const names = {
    calm_reset: "Calm reset",
    balanced_routine: "Balanced routine",
    rebuild_strength: "Rebuild strength",
  };
  const packs = {};
  Object.keys(names).forEach((id) => {
    packs[id] = {
      name: names[id],
      weights: weights[id] || {},
      constraints: defaults.contentPackConstraints?.[id] || {},
    };
  });
  return packs;
}

async function boot() {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  process.env.DATA_DIR = DATA_DIR;
  process.env.DB_PATH = path.join(DATA_DIR, "livenew.sqlite");
  process.env.ENV_MODE = process.env.ENV_MODE || "dev";
  process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || "admin@example.com";
  process.env.ADMIN_IN_DEV = "true";

  const domain = await import("../src/domain/index.js");
  const db = await import("../src/state/db.js");
  const params = await import("../src/server/parameters.js");
  const { toDayContract } = await import("../src/server/dayContract.js");

  const defaults = params.getDefaultParameters();
  await db.initDb();
  await db.seedContentItems(domain.defaultLibrary);
  await db.seedContentPacks(defaultPackSeeds(defaults));
  await db.seedFeatureFlags(DEFAULT_FLAGS);
  await db.seedParameters(defaults);
  params.resetParametersCache();
  const paramsState = await params.getParameters();

  return { domain, toDayContract, paramsState };
}

async function loadScenarios() {
  const raw = await fs.readFile(SCENARIOS_PATH, "utf8");
  const scenarios = JSON.parse(raw);
  if (!Array.isArray(scenarios)) {
    throw new Error("Golden scenarios must be an array");
  }
  return scenarios;
}

function buildScenarioDay({ scenario, domain, toDayContract, paramsState }) {
  const packId = scenario.packId || "balanced_routine";
  const tz = scenario.tz || "UTC";
  const dateISO = scenario.dateISO;
  const user = normalizeProfile(scenario.userProfile, packId, tz);
  const checkIn = {
    ...(scenario.checkIn || {}),
    dateISO,
  };
  const qualityRules = {
    avoidNoveltyWindowDays: 2,
    constraintsEnabled: true,
    noveltyEnabled: true,
    recoveryDebtEnabled: true,
    circadianAnchorsEnabled: true,
    safetyEnabled: true,
  };
  const { dayPlan, stressState } = domain.buildDayPlan({
    user,
    dateISO,
    checkIn,
    checkInsByDate: { [dateISO]: checkIn },
    completionsByDate: {},
    feedback: [],
    weekContext: { busyDays: user.busyDays || [], recentNoveltyGroups: [] },
    overrides: null,
    qualityRules,
    params: paramsState.map,
  });
  const state = domain.normalizeState({
    userProfile: user,
    weekPlan: {
      startDateISO: domain.weekStartMonday(dateISO),
      days: [dayPlan],
      version: 1,
    },
    checkIns: [checkIn],
    lastStressStateByDate: { [dateISO]: stressState },
    eventLog: [],
    partCompletionByDate: {},
    feedback: [],
    modifiers: {},
  });
  const day = toDayContract(state, dateISO, domain);
  return day;
}

async function main() {
  const allowDrift = process.env.ALLOW_SNAPSHOT_DRIFT === "true";
  const scenarios = await loadScenarios();
  const { domain, toDayContract, paramsState } = await boot();
  const drifts = [];

  for (const scenario of scenarios) {
    const day = buildScenarioDay({ scenario, domain, toDayContract, paramsState });
    const normalized = normalizeDayContract(day);
    const hash = sha256(stableStringify(normalized));
    const keyFields = keyFieldsFromDay(day);
    const expectedHash = scenario?.expected?.dayContractHash || "";
    const expectedKeyFields = scenario?.expected?.keyFields || {};

    const hashDrift = !expectedHash || expectedHash !== hash;
    const keyDrift = ["profile", "focus", "workoutId", "resetId", "nutritionId", "totalMinutes"].some(
      (key) => expectedKeyFields[key] !== keyFields[key]
    );

    if (hashDrift || keyDrift) {
      drifts.push({
        id: scenario.id,
        expectedHash,
        actualHash: hash,
        expectedKeyFields,
        actualKeyFields: keyFields,
      });
      if (allowDrift) {
        scenario.expected = {
          dayContractHash: hash,
          keyFields,
        };
      }
    }
  }

  if (drifts.length && allowDrift) {
    await fs.writeFile(SCENARIOS_PATH, JSON.stringify(scenarios, null, 2));
    await fs.writeFile(
      DRIFT_REPORT_PATH,
      JSON.stringify(
        {
          ok: true,
          generatedAt: new Date().toISOString(),
          driftCount: drifts.length,
          drifts,
        },
        null,
        2
      )
    );
  }

  if (drifts.length && !allowDrift) {
    const report = {
      ok: false,
      generatedAt: new Date().toISOString(),
      driftCount: drifts.length,
      drifts,
    };
    await fs.writeFile(DRIFT_REPORT_PATH, JSON.stringify(report, null, 2));
    console.error(`Golden snapshot drift detected: ${drifts.length} scenarios.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Golden snapshots OK (${scenarios.length} scenarios).`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
