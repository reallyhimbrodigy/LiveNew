import crypto from "crypto";

const DEFAULT_PROFILES = [
  "Balanced",
  "PoorSleep",
  "WiredOverstimulated",
  "DepletedBurnedOut",
  "RestlessAnxious",
];

const BASE_INPUT_SETS = [
  { key: "low_stress", stress: 3, sleepQuality: 8, energy: 7 },
  { key: "high_stress", stress: 9, sleepQuality: 6, energy: 4 },
  { key: "poor_sleep", stress: 7, sleepQuality: 3, energy: 3 },
];

function stableSort(list) {
  return list.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function buildBaseProfile({ packId, timezone = "UTC", dayBoundaryHour = 4 }) {
  return {
    id: `validator_${packId}`,
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
    contentPack: packId,
    timezone,
    dayBoundaryHour,
    constraints: {
      injuries: { knee: false, shoulder: false, back: false },
      equipment: { none: true, dumbbells: false, bands: false, gym: false },
      timeOfDayPreference: "any",
    },
  };
}

function buildLibraryFromItems({ items, baseLibrary, validateContentItem, log }) {
  const next = {
    ...baseLibrary,
    workouts: [],
    nutrition: [],
    resets: [],
  };
  const invalid = [];
  for (const item of items || []) {
    const validation = validateContentItem(item.kind, item, { allowDisabled: true });
    if (!validation.ok) {
      invalid.push({ id: item.id, kind: item.kind, field: validation.field, message: validation.message });
      continue;
    }
    if (item.kind === "workout") next.workouts.push(item);
    if (item.kind === "nutrition") next.nutrition.push(item);
    if (item.kind === "reset") next.resets.push(item);
  }
  if (invalid.length && typeof log === "function") {
    log({ event: "engine_validator_invalid_content", count: invalid.length, invalid: invalid.slice(0, 20) });
  }
  if (!next.workouts.length) next.workouts = baseLibrary.workouts;
  if (!next.nutrition.length) next.nutrition = baseLibrary.nutrition;
  if (!next.resets.length) next.resets = baseLibrary.resets;
  return next;
}

function failureForCell({ profile, timeAvailableMin, packId, inputs, err }) {
  const code = err?.code || "validator_error";
  const message = err?.message || "Validator cell failed";
  return { profile, timeAvailableMin, packId, inputs, code, message };
}

export function createEngineValidator({
  domain,
  toDayContract,
  assertDayContract,
  getParameters,
  listContentPacks,
  listContentItems,
  validateContentItem,
  loadSnapshotBundle,
  logInfo,
}) {
  if (!domain || !toDayContract || !assertDayContract) {
    throw new Error("createEngineValidator requires domain, toDayContract, and assertDayContract");
  }

  const log = (payload) => {
    if (typeof logInfo === "function") logInfo(payload);
  };

  return async function runEngineValidator(options = {}) {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const snapshotId = options.snapshotId || null;
    let paramsState = await getParameters();
    let paramsMap = paramsState?.map || {};
    let packIds = [];
    let library = null;
    let librarySource = "live";

    let snapshotMissing = false;
    if (snapshotId && typeof loadSnapshotBundle === "function") {
      const bundle = await loadSnapshotBundle(snapshotId);
      if (bundle) {
        paramsState = bundle.paramsState || paramsState;
        paramsMap = paramsState?.map || {};
        const snapshotPacks = bundle.packs || [];
        packIds = stableSort(
          snapshotPacks
            .map((entry) => entry.packId || entry.id || entry?.pack?.id)
            .filter(Boolean)
        );
        library = bundle.library || null;
        librarySource = "snapshot";
      } else {
        snapshotMissing = true;
      }
    }

    if (snapshotMissing) {
      const endedAt = new Date().toISOString();
      return {
        ok: false,
        runId,
        startedAt,
        endedAt,
        totals: { cells: 0, passed: 0, failed: 1 },
        failures: [
          {
            profile: "all",
            timeAvailableMin: null,
            packId: null,
            inputs: null,
            code: "snapshot_not_found",
            message: "Snapshot not found",
          },
        ],
        meta: {
          packs: [],
          profiles: stableSort(options.profiles || DEFAULT_PROFILES),
          timeBuckets: [],
          baseInputs: BASE_INPUT_SETS,
          dateISO: options.dateISO || domain.isoToday(),
          snapshotId,
          librarySource: "snapshot",
        },
      };
    }

    if (!packIds.length) {
      const packs = await listContentPacks();
      packIds = stableSort((packs || []).map((pack) => pack.id));
    }
    const timeBucketsRaw = paramsMap?.timeBuckets?.allowed || [5, 10, 15, 20, 30, 45, 60];
    const timeBuckets = stableSort(timeBucketsRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
    const profiles = stableSort(options.profiles || DEFAULT_PROFILES);
    const dateISO = options.dateISO || domain.isoToday();
    if (!library) {
      const items = await listContentItems(undefined, false, { statuses: ["enabled"] });
      library = buildLibraryFromItems({
        items,
        baseLibrary: domain.defaultLibrary,
        validateContentItem,
        log,
      });
    }

    let cells = 0;
    const failures = [];

    for (const packId of packIds) {
      for (const profile of profiles) {
        for (const timeAvailableMin of timeBuckets) {
          for (const baseInputs of BASE_INPUT_SETS) {
            cells += 1;
            const inputs = {
              ...baseInputs,
              timeAvailableMin,
            };
            try {
              const user = buildBaseProfile({ packId });
              const checkIn = {
                dateISO,
                stress: inputs.stress,
                sleepQuality: inputs.sleepQuality,
                energy: inputs.energy,
                timeAvailableMin: inputs.timeAvailableMin,
              };
              const overrides = { profileOverride: profile };
              const { dayPlan, stressState } = domain.buildDayPlan({
                user,
                dateISO,
                checkIn,
                checkInsByDate: { [dateISO]: checkIn },
                completionsByDate: {},
                feedback: [],
                weekContext: { busyDays: [], recentNoveltyGroups: [] },
                overrides,
                qualityRules: {
                  constraintsEnabled: true,
                  noveltyEnabled: true,
                  recoveryDebtEnabled: true,
                  circadianAnchorsEnabled: true,
                  safetyEnabled: true,
                },
                params: paramsMap,
                ruleConfig: { envMode: "alpha" },
                library,
              });
              if (!dayPlan?.reset?.id) {
                throw new Error("reset_missing");
              }
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
              assertDayContract(day);
            } catch (err) {
              const failure = failureForCell({ profile, timeAvailableMin, packId, inputs, err });
              if (failure.code === "validator_error" && String(failure.message).includes("reset_missing")) {
                failure.code = "reset_missing";
                failure.message = "No reset candidate produced";
              }
              failures.push(failure);
            }
          }
        }
      }
    }

    const endedAt = new Date().toISOString();
    const totals = {
      cells,
      passed: Math.max(0, cells - failures.length),
      failed: failures.length,
    };
    const report = {
      ok: failures.length === 0,
      runId,
      startedAt,
      endedAt,
      totals,
      failures,
      meta: {
        packs: packIds,
        profiles,
        timeBuckets,
        baseInputs: BASE_INPUT_SETS,
        dateISO,
        snapshotId: snapshotId || null,
        librarySource,
      },
    };
    return report;
  };
}
