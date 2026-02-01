import assert from "node:assert";
import { createPersist } from "../src/server/persist/index.js";
import {
  computeSupabaseUiState,
  supabaseConsentStatus,
  supabaseProfileCompleteness,
} from "../src/server/supabase/helpers.js";

function createMockSupabase() {
  const tables = {
    user_profile: [],
    checkin: [],
    event: [],
    derived_state: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.range = {};
      this.sort = null;
      this._result = null;
      this._error = null;
    }

    select() {
      return this;
    }

    eq(field, value) {
      this.filters.push({ field, value });
      return this;
    }

    gte(field, value) {
      this.range[field] = this.range[field] || {};
      this.range[field].gte = value;
      return this;
    }

    lte(field, value) {
      this.range[field] = this.range[field] || {};
      this.range[field].lte = value;
      return this;
    }

    order(field, { ascending = true } = {}) {
      this.sort = { field, ascending };
      return this;
    }

    insert(row) {
      const rows = Array.isArray(row) ? row : [row];
      const table = tables[this.table];
      for (const entry of rows) {
        if (this.table === "event") {
          if (entry.idempotency_key) {
            const dupe = table.find(
              (evt) => evt.user_id === entry.user_id && evt.idempotency_key === entry.idempotency_key
            );
            if (dupe) {
              this._error = { code: "23505" };
              return this;
            }
          }
          if (["rail_opened", "reset_completed", "checkin_submitted"].includes(entry.type)) {
            const dupe = table.find(
              (evt) => evt.user_id === entry.user_id && evt.type === entry.type && evt.date_key === entry.date_key
            );
            if (dupe) {
              this._error = { code: "23505" };
              return this;
            }
          }
        }
        table.push({ ...entry });
        this._result = entry;
      }
      return this;
    }

    upsert(row, { onConflict } = {}) {
      const rows = Array.isArray(row) ? row : [row];
      const table = tables[this.table];
      const keys = (onConflict || "").split(",").map((k) => k.trim()).filter(Boolean);
      for (const entry of rows) {
        const match = table.find((existing) => keys.every((key) => existing[key] === entry[key]));
        if (match) {
          Object.assign(match, entry);
          this._result = match;
        } else {
          table.push({ ...entry });
          this._result = entry;
        }
      }
      return this;
    }

    async maybeSingle() {
      const rows = this._selectRows();
      return { data: rows[0] || null, error: this._error };
    }

    async single() {
      if (this._error) return { data: null, error: this._error };
      if (this._result) return { data: this._result, error: null };
      const rows = this._selectRows();
      return { data: rows[0] || null, error: null };
    }

    _selectRows() {
      let rows = tables[this.table].slice();
      this.filters.forEach((filter) => {
        rows = rows.filter((row) => row[filter.field] === filter.value);
      });
      Object.keys(this.range).forEach((field) => {
        const { gte, lte } = this.range[field];
        if (gte != null) rows = rows.filter((row) => row[field] >= gte);
        if (lte != null) rows = rows.filter((row) => row[field] <= lte);
      });
      if (this.sort) {
        const { field, ascending } = this.sort;
        rows.sort((a, b) => {
          if (a[field] === b[field]) return 0;
          return ascending ? (a[field] < b[field] ? -1 : 1) : a[field] > b[field] ? -1 : 1;
        });
      }
      return rows;
    }

    then(resolve, reject) {
      try {
        const rows = this._selectRows();
        resolve({ data: rows, error: this._error });
      } catch (err) {
        reject(err);
      }
    }
  }

  return {
    from(table) {
      return new Query(table);
    },
  };
}

async function testBootstrapUiStateTransitions() {
  const requiredVersion = 2;
  const profile = {
    timezone: "America/Los_Angeles",
    dayBoundaryMinute: 240,
    consentAcceptedAt: new Date().toISOString(),
    consentVersion: requiredVersion,
    onboardingCompletedAt: new Date().toISOString(),
  };
  const consent = supabaseConsentStatus(profile, requiredVersion);
  const profileStatus = supabaseProfileCompleteness(profile);
  const uiHome = computeSupabaseUiState({
    isAuthenticated: true,
    consentComplete: consent.consentComplete,
    consentVersionOk: consent.version >= requiredVersion,
    profileComplete: profileStatus.isComplete,
    onboardingComplete: true,
    canaryAllowed: true,
  });
  assert.strictEqual(uiHome, "home");

  const uiConsent = computeSupabaseUiState({
    isAuthenticated: true,
    consentComplete: false,
    consentVersionOk: false,
    profileComplete: true,
    onboardingComplete: true,
    canaryAllowed: true,
  });
  assert.strictEqual(uiConsent, "consent");

  const uiOnboard = computeSupabaseUiState({
    isAuthenticated: true,
    consentComplete: true,
    consentVersionOk: true,
    profileComplete: false,
    onboardingComplete: false,
    canaryAllowed: true,
  });
  assert.strictEqual(uiOnboard, "onboard");

  const uiLogin = computeSupabaseUiState({
    isAuthenticated: false,
    consentComplete: false,
    consentVersionOk: false,
    profileComplete: false,
    onboardingComplete: false,
    canaryAllowed: true,
  });
  assert.strictEqual(uiLogin, "login");
}

async function testCheckinUpsertOnePerDateKey() {
  const supabase = createMockSupabase();
  const persist = createPersist(supabase);
  await persist.upsertCheckin("user-1", "2026-01-30", { stress: 4, sleepQuality: 6, energy: 5, timeAvailableMin: 20 });
  await persist.upsertCheckin("user-1", "2026-01-30", { stress: 7, sleepQuality: 5, energy: 4, timeAvailableMin: 15 });
  const stored = await persist.getCheckinByDateKey("user-1", "2026-01-30");
  assert.strictEqual(stored.stress, 7);
  assert.strictEqual(stored.timeAvailableMin, 15);
}

async function testResetCompleteIdempotent() {
  const supabase = createMockSupabase();
  const persist = createPersist(supabase);
  const first = await persist.insertEventOncePerDay("user-1", "2026-01-30", "reset_completed", { v: 1 });
  const second = await persist.insertEventOncePerDay("user-1", "2026-01-30", "reset_completed", { v: 1 });
  assert.strictEqual(first.inserted, true);
  assert.strictEqual(second.inserted, false);
}

async function testOutcomesFromEvents() {
  const supabase = createMockSupabase();
  const persist = createPersist(supabase);
  await persist.insertEventOncePerDay("user-1", "2026-01-28", "rail_opened", {});
  await persist.insertEventOncePerDay("user-1", "2026-01-28", "checkin_submitted", {});
  await persist.insertEventOncePerDay("user-1", "2026-01-29", "rail_opened", {});
  await persist.insertEventOncePerDay("user-1", "2026-01-29", "reset_completed", {});
  await persist.insertEventOncePerDay("user-1", "2026-01-29", "checkin_submitted", {});
  const events = await persist.listEvents("user-1", "2026-01-28", "2026-01-29");
  const railDays = new Set();
  const resetDays = new Set();
  const checkinDays = new Set();
  events.forEach((event) => {
    if (event.type === "rail_opened") railDays.add(event.dateKey);
    if (event.type === "reset_completed") resetDays.add(event.dateKey);
    if (event.type === "checkin_submitted") checkinDays.add(event.dateKey);
  });
  assert.strictEqual(railDays.size, 2);
  assert.strictEqual(resetDays.size, 1);
  assert.strictEqual(checkinDays.size, 2);
}

async function testQuickIdempotency() {
  const supabase = createMockSupabase();
  const persist = createPersist(supabase);
  const first = await persist.insertEventIdempotent("user-1", "2026-01-30", "quick_signal", "key-1", { signal: "stressed" });
  const second = await persist.insertEventIdempotent("user-1", "2026-01-30", "quick_signal", "key-1", { signal: "stressed" });
  assert.strictEqual(first.inserted, true);
  assert.strictEqual(second.inserted, false);
}

async function run() {
  await testBootstrapUiStateTransitions();
  await testCheckinUpsertOnePerDateKey();
  await testResetCompleteIdempotent();
  await testOutcomesFromEvents();
  await testQuickIdempotency();
  console.log("supabase.persistence.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
