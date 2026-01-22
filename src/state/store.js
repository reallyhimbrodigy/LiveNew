import { create } from "zustand";
import { loadJSON, removeJSON, saveJSON } from "./persist";
import { generateWeekPlan } from "../domain/planEngine";
import { weekStartISO } from "../domain/week";
import { adaptWeekPlan, applyStressorToWeekPlan } from "../domain/adapt";

const STORAGE_KEY = "livegood:v1";
const SCHEMA_VERSION = 1;

export const useAppStore = create((set, get) => ({
  baseline: null,
  weekPlan: null,
  checkIns: [],
  completions: {},
  stressors: [],

  hydrate: async () => {
    const saved = await loadJSON(STORAGE_KEY);
    if (!saved) return;
    if (saved.schemaVersion !== SCHEMA_VERSION) {
      const reset = {
        schemaVersion: SCHEMA_VERSION,
        baseline: null,
        weekPlan: null,
        checkIns: [],
        completions: {},
        stressors: [],
      };
      set({
        baseline: reset.baseline,
        weekPlan: reset.weekPlan,
        checkIns: reset.checkIns,
        completions: reset.completions,
        stressors: reset.stressors,
      });
      await saveJSON(STORAGE_KEY, reset);
      return;
    }

    set({
      baseline: saved.baseline ?? null,
      weekPlan: saved.weekPlan ?? null,
      checkIns: saved.checkIns ?? [],
      completions: saved.completions ?? {},
      stressors: saved.stressors ?? [],
    });
  },

  resetData: async () => {
    await removeJSON(STORAGE_KEY);
    set({ baseline: null, weekPlan: null, checkIns: [], completions: {}, stressors: [] });
  },

  setBaseline: async (b) => {
    set({ baseline: b });
    await persist();
  },

  buildWeek: async (startDateISO) => {
    const b = get().baseline;
    if (!b) return;
    const normalized = weekStartISO(startDateISO);
    const plan = generateWeekPlan(b, normalized);
    set({ weekPlan: plan });
    await persist();
  },

  ensureCurrentWeek: async () => {
    const b = get().baseline;
    if (!b) return;
    const currentWeekStart = weekStartISO(new Date().toISOString().slice(0, 10));
    const plan = get().weekPlan;
    if (!plan || plan.startDateISO !== currentWeekStart) {
      await get().buildWeek(currentWeekStart);
    }
  },

  addCheckIn: async (c) => {
    const state = get();
    const filtered = state.checkIns.filter((item) => item.dateISO !== c.dateISO);
    const next = [c, ...filtered].slice(0, 60);
    const nextPlan =
      state.baseline && state.weekPlan ? adaptWeekPlan(state.weekPlan, state.baseline, next) : state.weekPlan;
    set({ checkIns: next, weekPlan: nextPlan });
    await persist();
  },

  toggleCompletion: async (blockId) => {
    const current = get().completions;
    const next = { ...current, [blockId]: !current[blockId] };
    set({ completions: next });
    await persist();
  },

  addStressor: async (kind, dateISO) => {
    const state = get();
    if (state.stressors.some((s) => s.dateISO === dateISO && s.kind === kind)) return;
    const id = Math.random().toString(36).slice(2);
    const nextStressors = [{ id, dateISO, kind }, ...state.stressors];
    const nextPlan =
      state.baseline && state.weekPlan ? applyStressorToWeekPlan(state.weekPlan, dateISO) : state.weekPlan;
    set({ stressors: nextStressors, weekPlan: nextPlan });
    await persist();
  },
}));

async function persist() {
  const s = useAppStore.getState();
  await saveJSON(STORAGE_KEY, {
    schemaVersion: SCHEMA_VERSION,
    baseline: s.baseline,
    weekPlan: s.weekPlan,
    checkIns: s.checkIns,
    completions: s.completions,
    stressors: s.stressors,
  });
}
