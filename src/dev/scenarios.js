function defaultUserProfile(todayISO) {
  return {
    id: "demo_user",
    createdAtISO: todayISO,
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
  };
}

function basePatch(state, ctx) {
  const todayISO = ctx?.now?.todayISO || ctx?.domain?.isoToday?.() || new Date().toISOString().slice(0, 10);
  return {
    userProfile: state.userProfile || defaultUserProfile(todayISO),
    checkIns: [],
    weekPlan: null,
    modifiers: state.modifiers || {},
  };
}

function makeCheckIn(dateISO, overrides) {
  return {
    dateISO,
    stress: 6,
    sleepQuality: 6,
    energy: 6,
    timeAvailableMin: 20,
    ...overrides,
  };
}

const BASE_SCENARIOS = [
  {
    id: "no_checkins",
    title: "No check-ins",
    seed: (state, ctx) => basePatch(state, ctx),
  },
  {
    id: "poor_sleep_day",
    title: "Poor sleep day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        checkIns: [makeCheckIn(todayISO, { sleepQuality: 3, stress: 6, timeAvailableMin: 20 })],
      };
    },
  },
  {
    id: "wired_day",
    title: "Wired day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        checkIns: [makeCheckIn(todayISO, { stress: 9, sleepQuality: 6, energy: 5, timeAvailableMin: 20 })],
      };
    },
  },
  {
    id: "ten_min_day",
    title: "10 minute day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        checkIns: [makeCheckIn(todayISO, { timeAvailableMin: 10 })],
      };
    },
  },
  {
    id: "busy_day",
    title: "Busy day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        userProfile: { ...patch.userProfile, busyDays: [todayISO] },
        checkIns: [makeCheckIn(todayISO, { timeAvailableMin: 30 })],
      };
    },
  },
  {
    id: "bad_day_mode",
    title: "Bad day mode",
    seed: (state, ctx) => basePatch(state, ctx),
    events: ({ todayISO }) => [{ type: "BAD_DAY_MODE", payload: { dateISO: todayISO } }],
  },
  {
    id: "feedback_too_hard",
    title: "Feedback: too hard",
    seed: (state, ctx) => basePatch(state, ctx),
    events: ({ todayISO }) => [
      { type: "FEEDBACK_SUBMITTED", payload: { dateISO: todayISO, helped: false, reason: "too_hard" } },
    ],
  },
  {
    id: "feedback_not_relevant",
    title: "Feedback: not relevant",
    seed: (state, ctx) => basePatch(state, ctx),
    events: ({ todayISO }) => [
      { type: "FEEDBACK_SUBMITTED", payload: { dateISO: todayISO, helped: false, reason: "not_relevant" } },
    ],
  },
];

const EXTRA_SCENARIOS = [
  {
    id: "balanced_day",
    title: "Balanced day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        checkIns: [makeCheckIn(todayISO, { stress: 4, sleepQuality: 7, energy: 7, timeAvailableMin: 30 })],
      };
    },
  },
  {
    id: "depleted_day",
    title: "Depleted day",
    seed: (state, ctx) => {
      const patch = basePatch(state, ctx);
      const todayISO = ctx?.now?.todayISO || new Date().toISOString().slice(0, 10);
      return {
        ...patch,
        checkIns: [makeCheckIn(todayISO, { stress: 7, sleepQuality: 4, energy: 3, timeAvailableMin: 20 })],
      };
    },
  },
];

export const SCENARIOS = BASE_SCENARIOS;
const ALL_SCENARIOS = [...BASE_SCENARIOS, ...EXTRA_SCENARIOS];

export function getScenarioById(id) {
  return ALL_SCENARIOS.find((scenario) => scenario.id === id) || null;
}
