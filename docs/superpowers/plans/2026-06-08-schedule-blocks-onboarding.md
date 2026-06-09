# Schedule Blocks Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text routine essay in onboarding with a guided, day-aware schedule builder, and rewire the plan-generation prompt to use today's resolved commitments — so plans stay richly tailored while onboarding becomes fast and non-glitchy for new users and invisible to returning ones.

**Architecture:** Pure schedule logic lives in a new `src/domain/schedule.js` (testable with the repo's node-script test style). The client stores a structured `schedule` object inside the profile/constraints and derives a back-compat `routine` summary string so the existing `hasProfile` gate is untouched. The server persists `schedule` in `constraints_json`, returns it in the bootstrap payload, and resolves "today" via `resolveDaySchedule()` before building the AI prompt. A new guided UI flow (triage → per-activity card → wrap) replaces onboarding Step 1; the same flow is reachable from Account for edits/late setup.

**Tech Stack:** React Native (Expo), Zustand store, Node server, Supabase (`user_profile.constraints_json`), Anthropic plan generation in `src/domain/aiDayPlan.js`. Tests: ESM node scripts under `scripts/*.test.js` using `node:assert` (no jest). UI verified by Metro bundle + manual run (repo has no RN unit harness).

**Spec:** `docs/superpowers/specs/2026-06-08-schedule-blocks-onboarding-design.md`

---

## File Structure

- **Create** `src/domain/schedule.js` — pure schedule logic: `dayIndex()`, `DEFAULT_MEALS`, `normalizeSchedule()`, `resolveDaySchedule()`, `deriveRoutineSummary()`. Single responsibility: schedule data semantics. Used by both client and server.
- **Create** `scripts/schedule.test.js` — node-script tests for `src/domain/schedule.js`.
- **Modify** `src/domain/aiDayPlan.js` — consume a resolved `daySchedule` in the prompt; fall back to legacy `routine`.
- **Modify** server plan-generation caller — compute `resolveDaySchedule(profile.constraints.schedule, today)` and pass to `aiDayPlan`.
- **Modify** server `onboard/complete` handler + `persist.updateOnboarding` — persist `constraints.schedule`.
- **Modify** server `buildSupabaseBootstrapPayload` — return `schedule` in the profile block.
- **Modify** `src/store/authStore.js` — carry `schedule` through `saveProfile`/`saveProfileWithoutNav`; set derived `routine` summary; keep `hasProfile`/onboarded-marker behavior.
- **Create** `src/components/schedule/DayToggle.jsx`, `TimeField.jsx`, `ActivityCard.jsx` — reusable builder primitives (new design system).
- **Create** `src/screens/onboarding/ScheduleBuilder.jsx` — the guided triage→per-activity→wrap flow.
- **Modify** `src/screens/OnboardingScreen.jsx` — replace Step 1 essay with `ScheduleBuilder`.
- **Modify** `src/screens/AccountScreen.jsx` — add **Schedule** entry that opens the builder; one-time dismissible nudge for users without a schedule.

---

## Task 1: Day-index helper (0 = Monday convention)

**Files:**
- Create: `src/domain/schedule.js`
- Test: `scripts/schedule.test.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/schedule.test.js
import assert from "node:assert";
import { dayIndex } from "../src/domain/schedule.js";

// JS getDay(): 0=Sun..6=Sat. Our convention: 0=Mon..6=Sun.
assert.equal(dayIndex(new Date("2026-06-08T12:00:00")), 0, "Monday -> 0");
assert.equal(dayIndex(new Date("2026-06-13T12:00:00")), 5, "Saturday -> 5");
assert.equal(dayIndex(new Date("2026-06-14T12:00:00")), 6, "Sunday -> 6");
console.log("dayIndex OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/schedule.test.js`
Expected: FAIL — `Cannot find module '../src/domain/schedule.js'` (or `dayIndex is not a function`).

- [ ] **Step 3: Write minimal implementation**

```js
// src/domain/schedule.js

// Convert JS Date.getDay() (0=Sun..6=Sat) to our convention 0=Mon..6=Sun.
// This is the ONLY place that mapping lives — everything uses dayIndex().
export function dayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/schedule.test.js`
Expected: prints `dayIndex OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule.js scripts/schedule.test.js
git commit -m "feat(schedule): dayIndex helper (0=Mon convention)"
```

---

## Task 2: Defaults + normalizeSchedule

**Files:**
- Modify: `src/domain/schedule.js`
- Test: `scripts/schedule.test.js`

- [ ] **Step 1: Add failing tests**

Append to `scripts/schedule.test.js`:

```js
import { normalizeSchedule, DEFAULT_MEALS } from "../src/domain/schedule.js";

// Null/garbage -> a safe empty schedule with default meals.
const empty = normalizeSchedule(null);
assert.deepEqual(empty.blocks, [], "null -> empty blocks");
assert.deepEqual(empty.meals, DEFAULT_MEALS, "null -> default meals");

// Drops malformed blocks; keeps valid ones; fills missing meals.
const n = normalizeSchedule({
  blocks: [
    { id: "a", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
    { id: "b", label: "", start: "bad", days: "nope" }, // malformed -> dropped
  ],
  meals: { lunch: "13:00" },
});
assert.equal(n.blocks.length, 1, "drops malformed block");
assert.equal(n.meals.lunch, "13:00", "keeps provided meal");
assert.equal(n.meals.breakfast, DEFAULT_MEALS.breakfast, "fills missing meal");
console.log("normalizeSchedule OK");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/schedule.test.js`
Expected: FAIL — `normalizeSchedule is not a function`.

- [ ] **Step 3: Implement**

Append to `src/domain/schedule.js`:

```js
export const DEFAULT_MEALS = { breakfast: "08:00", lunch: "12:30", dinner: "19:00" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isHHMM = (v) => typeof v === "string" && HHMM.test(v);
const isValidBlock = (b) =>
  b && typeof b === "object" &&
  typeof b.label === "string" && b.label.trim().length > 0 &&
  isHHMM(b.start) &&
  (b.end == null || isHHMM(b.end)) &&
  Array.isArray(b.days) && b.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

// Returns a safe, fully-formed schedule. Drops malformed blocks, fills meals.
export function normalizeSchedule(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const blocks = Array.isArray(src.blocks) ? src.blocks.filter(isValidBlock) : [];
  const meals = { ...DEFAULT_MEALS, ...(src.meals && typeof src.meals === "object" ? src.meals : {}) };
  const cleanTime = (t) => (t && typeof t === "object"
    ? { source: t.source === "health" ? "health" : "manual",
        weekday: isHHMM(t.weekday) ? t.weekday : null,
        weekend: isHHMM(t.weekend) ? t.weekend : null }
    : null);
  return {
    version: 1,
    blocks,
    wake: cleanTime(src.wake),
    sleep: cleanTime(src.sleep),
    meals,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/schedule.test.js`
Expected: prints `normalizeSchedule OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule.js scripts/schedule.test.js
git commit -m "feat(schedule): defaults + normalizeSchedule validation"
```

---

## Task 3: resolveDaySchedule (today's facts)

**Files:**
- Modify: `src/domain/schedule.js`
- Test: `scripts/schedule.test.js`

- [ ] **Step 1: Add failing tests**

Append to `scripts/schedule.test.js`:

```js
import { resolveDaySchedule } from "../src/domain/schedule.js";

const sched = normalizeSchedule({
  blocks: [
    { id: "w", type: "work", label: "Work", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] },
    { id: "g", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
  ],
  wake: { source: "manual", weekday: "06:40", weekend: "09:10" },
  sleep: { source: "manual", weekday: "23:10", weekend: "23:30" },
});

// Saturday (2026-06-13): no work, gym is on (Sat=5), weekend wake.
const sat = resolveDaySchedule(sched, new Date("2026-06-13T12:00:00"));
assert.equal(sat.weekdayName, "Saturday");
assert.equal(sat.isWeekend, true);
assert.deepEqual(sat.commitments.map((c) => c.label), ["Gym"], "Sat: only gym");
assert.equal(sat.wake, "09:10", "Sat uses weekend wake");

// Monday (2026-06-08): work on, gym off, weekday wake.
const mon = resolveDaySchedule(sched, new Date("2026-06-08T12:00:00"));
assert.deepEqual(mon.commitments.map((c) => c.label), ["Work"], "Mon: only work");
assert.equal(mon.wake, "06:40", "Mon uses weekday wake");

assert.equal(resolveDaySchedule(null), null, "null schedule -> null");
console.log("resolveDaySchedule OK");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/schedule.test.js`
Expected: FAIL — `resolveDaySchedule is not a function`.

- [ ] **Step 3: Implement**

Append to `src/domain/schedule.js`:

```js
// Resolve a schedule to the concrete facts for a given calendar day.
export function resolveDaySchedule(schedule, date = new Date()) {
  if (!schedule || typeof schedule !== "object" || !Array.isArray(schedule.blocks)) return null;
  const di = dayIndex(date);          // 0=Mon..6=Sun
  const isWeekend = di >= 5;          // Sat(5), Sun(6)
  const commitments = schedule.blocks
    .filter((b) => Array.isArray(b.days) && b.days.includes(di))
    .map((b) => ({ label: b.label, start: b.start, end: b.end || null }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const pick = (field) => {
    const f = schedule[field];
    if (!f) return null;
    return isWeekend && f.weekend ? f.weekend : f.weekday || null;
  };
  return {
    weekdayName: date.toLocaleDateString("en-US", { weekday: "long" }),
    isWeekend,
    commitments,
    wake: pick("wake"),
    sleep: pick("sleep"),
    meals: schedule.meals || DEFAULT_MEALS,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/schedule.test.js`
Expected: prints `resolveDaySchedule OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule.js scripts/schedule.test.js
git commit -m "feat(schedule): resolveDaySchedule for a given day"
```

---

## Task 4: deriveRoutineSummary (back-compat string)

**Files:**
- Modify: `src/domain/schedule.js`
- Test: `scripts/schedule.test.js`

- [ ] **Step 1: Add failing test**

Append to `scripts/schedule.test.js`:

```js
import { deriveRoutineSummary } from "../src/domain/schedule.js";

const summary = deriveRoutineSummary(normalizeSchedule({
  blocks: [
    { id: "w", type: "work", label: "Work", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4] },
    { id: "g", type: "gym", label: "Gym", start: "18:00", end: "19:00", days: [1, 3, 5] },
  ],
  wake: { source: "manual", weekday: "06:40" },
}));
assert.ok(summary.includes("Work 09:00-17:00 (weekdays)"), "summarizes weekdays");
assert.ok(summary.includes("Gym 18:00-19:00 (Tue/Thu/Sat)"), "summarizes day list");
assert.ok(summary.length > 5, "non-empty so hasProfile gate stays true");
console.log("deriveRoutineSummary OK");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/schedule.test.js`
Expected: FAIL — `deriveRoutineSummary is not a function`.

- [ ] **Step 3: Implement**

Append to `src/domain/schedule.js`:

```js
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days) {
  const set = [...days].sort((a, b) => a - b);
  const key = set.join(",");
  if (set.length === 7) return "every day";
  if (key === "0,1,2,3,4") return "weekdays";
  if (key === "5,6") return "weekends";
  return set.map((d) => DAY_LABELS[d]).join("/");
}

// Human-readable summary stored in the legacy `routine` field so the existing
// hasProfile gate (!!profile.routine) and the aiDayPlan fallback keep working.
export function deriveRoutineSummary(schedule) {
  if (!schedule || !Array.isArray(schedule.blocks)) return "";
  const parts = schedule.blocks.map((b) => {
    const time = b.end ? `${b.start}-${b.end}` : b.start;
    return `${b.label} ${time} (${formatDays(b.days)})`;
  });
  const wake = schedule.wake?.weekday ? `wake ${schedule.wake.weekday}` : null;
  const sleep = schedule.sleep?.weekday ? `sleep ${schedule.sleep.weekday}` : null;
  return [wake, ...parts, sleep].filter(Boolean).join(", ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/schedule.test.js`
Expected: prints `deriveRoutineSummary OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule.js scripts/schedule.test.js
git commit -m "feat(schedule): deriveRoutineSummary for back-compat"
```

---

## Task 5: Rewrite the plan prompt to use today's schedule

**Files:**
- Modify: `src/domain/aiDayPlan.js` (routine-injection block, around the `My typical routine (a reference, not a constraint)` line ~248)
- Modify: the server caller that invokes `aiDayPlan` (compute + pass `daySchedule`)

- [ ] **Step 1: Add `daySchedule` to the prompt builder's destructured params**

In `src/domain/aiDayPlan.js`, find where the user-message builder destructures its argument (it already reads `routine`, `history`, `stressLabel`, etc.). Add `daySchedule` to that destructure (default `null`).

- [ ] **Step 2: Replace the routine line with day-resolved context**

Find:

```js
  // 3. Routine — typical reference shape.
  lines.push(`My typical routine (a reference, not a constraint): ${routineText}`);
  lines.push("");
```

Replace with:

```js
  // 3. Today's actual schedule (preferred) or legacy routine fallback.
  if (daySchedule) {
    const items = daySchedule.commitments.length
      ? daySchedule.commitments
          .map((c) => (c.end ? `${c.label} ${c.start}-${c.end}` : `${c.label} ${c.start}`))
          .join(", ")
      : "nothing scheduled";
    const wake = daySchedule.wake ? `wake ~${daySchedule.wake}` : "";
    const sleep = daySchedule.sleep ? `sleep ~${daySchedule.sleep}` : "";
    const timing = [wake, sleep].filter(Boolean).join(", ");
    lines.push(`Today is ${daySchedule.weekdayName}. On my schedule today: ${items}.${timing ? ` (${timing}.)` : ""}`);
    lines.push("Build the plan around today's real commitments and timing.");
  } else {
    lines.push(`My typical routine (a reference, not a constraint): ${routineText}`);
  }
  lines.push("");
```

- [ ] **Step 3: Compute and pass `daySchedule` from the server caller**

In the server module that calls the prompt builder for a user's plan, add near where it already reads the profile/constraints:

```js
import { resolveDaySchedule, normalizeSchedule } from "../domain/schedule.js"; // adjust relative path
// ...
const daySchedule = resolveDaySchedule(
  normalizeSchedule(userProfile?.constraints?.schedule),
  new Date()
);
// pass daySchedule alongside the existing routine/history args into the prompt builder
```

(If `constraints.schedule` is absent, `normalizeSchedule` yields empty blocks → `resolveDaySchedule` still returns an object with `commitments: []`. To preserve *exact* legacy behavior for users who never built a schedule, pass `daySchedule = userProfile?.constraints?.schedule ? resolved : null` so the `else` fallback fires.)

- [ ] **Step 4: Verify the bundle + a prompt smoke check**

Run: `node scripts/schedule.test.js` (still green)
Run: `node -e "import('./src/domain/aiDayPlan.js').then(()=>console.log('aiDayPlan imports OK')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: both succeed. Manually read the new lines to confirm no template errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/aiDayPlan.js
# plus the server caller file you edited
git commit -m "feat(plan): build prompt from today's resolved schedule, routine fallback"
```

---

## Task 6: Persist schedule on the server

**Files:**
- Modify: server `onboard/complete` handler + `persist.updateOnboarding` (writes `constraints_json`)
- Modify: `buildSupabaseBootstrapPayload` (returns `profile.schedule`)

- [ ] **Step 1: Accept and store `schedule` in onboarding completion**

In the `/v1/onboard/complete` handler, the incoming `profile` already carries `routine`, `wakeTime`, etc. Pull `schedule` off it, normalize, and merge into the constraints written by `persist.updateOnboarding`:

```js
import { normalizeSchedule } from "../domain/schedule.js"; // adjust path
// ...
const incomingSchedule = profile?.schedule ? normalizeSchedule(profile.schedule) : undefined;
const mergedConstraints = {
  ...existingConstraints,
  ...(incomingSchedule ? { schedule: incomingSchedule } : {}),
  // keep existing routine/wakeTime writes as-is
};
```

- [ ] **Step 2: Return `schedule` in the bootstrap payload**

In `buildSupabaseBootstrapPayload`, the `profile` object already exposes `routine`, `wakeTime`, etc. from `constraints`. Add:

```js
    profile: {
      // ...existing fields...
      schedule: constraints.schedule || null,
    },
```

- [ ] **Step 3: Verify server boots and bootstrap shape**

Run: `node -e "import('./src/server/supabase/helpers.js').then(()=>console.log('helpers import OK')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: OK. (Full server smoke is covered by existing `npm run test:integration` if available.)

- [ ] **Step 4: Commit**

```bash
git add src/server
git commit -m "feat(server): persist + return schedule in constraints/bootstrap"
```

---

## Task 7: Client store — carry schedule + derive routine

**Files:**
- Modify: `src/store/authStore.js` (`saveProfile`, `saveProfileWithoutNav`, and the bootstrap profile merge ~lines 211-219)

- [ ] **Step 1: Thread `schedule` through save + derive routine summary**

At the top of `src/store/authStore.js` add:

```js
import { normalizeSchedule, deriveRoutineSummary } from '../domain/schedule.js';
```

In `saveProfileWithoutNav` (and mirror in `saveProfile`), before the `api.onboardComplete(profile)` call, when `profile.schedule` is present derive the routine summary so the existing `hasProfile` gate stays satisfied:

```js
  saveProfileWithoutNav: async (profile) => {
    await api.acceptConsent();
    const withSchedule = profile.schedule
      ? { ...profile, schedule: normalizeSchedule(profile.schedule),
          routine: profile.routine || deriveRoutineSummary(normalizeSchedule(profile.schedule)) }
      : profile;
    await api.onboardComplete(withSchedule);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(withSchedule));
    await AsyncStorage.removeItem(PLAN_KEY);
    await writeOnboardedMarker(get().userId);
    set({ profile: withSchedule, todayPlan: null, todayDate: null, completed: {}, reflection: null });
  },
```

- [ ] **Step 2: Include `schedule` in the bootstrap profile merge**

In `hydrate`'s server-profile merge (the `merged = { routine: ..., ... }` object ~line 211), add:

```js
      schedule: serverProfile.schedule || localProfile.schedule || null,
```

And in `postSignInBootstrap`'s `profile` object (~line 435), add `schedule: p.schedule || null,`.

- [ ] **Step 3: Verify the iOS bundle still compiles**

Run: `npx expo export --platform ios --output-dir /tmp/livenew-export-t7`
Expected: exit 0, a `.hbc` bundle produced (no resolution/syntax errors).

- [ ] **Step 4: Commit**

```bash
git add src/store/authStore.js
git commit -m "feat(store): carry schedule through save/bootstrap, derive routine summary"
```

---

## Task 8: Builder primitives — DayToggle, TimeField, ActivityCard

**Files:**
- Create: `src/components/schedule/DayToggle.jsx`
- Create: `src/components/schedule/TimeField.jsx`
- Create: `src/components/schedule/ActivityCard.jsx`

> No RN unit harness in repo — verify via bundle + manual render. Follow the app pattern: functional component, `useTheme()`, `makeStyles(colors, fonts)`, crafted SVG/View icons (NOT emoji), 44pt touch targets.

- [ ] **Step 1: DayToggle — a 7-pill Mon..Sun selector**

```jsx
// src/components/schedule/DayToggle.jsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';

const LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // index 0=Mon..6=Sun

// value: number[] of day indices (0=Mon..6=Sun). onChange(nextArray).
export default function DayToggle({ value = [], onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const toggle = (i) =>
    onChange(value.includes(i) ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <View style={s.row} accessibilityRole="radiogroup">
      {LABELS.map((label, i) => {
        const on = value.includes(i);
        return (
          <Pressable
            key={i}
            onPress={() => toggle(i)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}
            style={[s.pill, on && s.pillOn]}
          >
            <Text style={[s.label, on && s.labelOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
    pill: {
      width: 40, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    },
    pillOn: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
    label: { fontFamily: fonts.displaySemibold, fontSize: 14, color: colors.muted },
    labelOn: { color: colors.gold },
  });
}
```

- [ ] **Step 2: TimeField — a tappable time that opens the native picker**

```jsx
// src/components/schedule/TimeField.jsx
import React, { useState } from 'react';
import { Pressable, Text, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme';

// value: "HH:MM" string. onChange("HH:MM").
function toDate(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const d = new Date(); d.setHours(h || 9, m || 0, 0, 0); return d;
}
function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function label12(hhmm) {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const ap = h < 12 ? 'a' : 'p'; const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

export default function TimeField({ value, onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={s.field} onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={s.text}>{label12(value)}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => { setOpen(Platform.OS === 'ios'); if (d) onChange(toHHMM(d)); }}
        />
      )}
    </>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    field: {
      minWidth: 84, height: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center',
      borderWidth: 1, borderColor: colors.goldBorder, backgroundColor: colors.surface,
    },
    text: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.text },
  });
}
```

> If `@react-native-community/datetimepicker` is not installed, install it (`npx expo install @react-native-community/datetimepicker`) as part of this step and note it in the commit; it is config-plugin-free and prebuild-safe.

- [ ] **Step 3: ActivityCard — one block's editor (label + time(s) + days)**

```jsx
// src/components/schedule/ActivityCard.jsx
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import TimeField from './TimeField';
import DayToggle from './DayToggle';

// block: { label, start, end|null, days:number[] }; onChange(nextBlock).
export default function ActivityCard({ block, editableLabel = false, onChange }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const set = (patch) => onChange({ ...block, ...patch });
  return (
    <View style={s.card}>
      {editableLabel ? (
        <TextInput
          style={s.labelInput}
          value={block.label}
          onChangeText={(t) => set({ label: t })}
          placeholder="What is it?"
          placeholderTextColor={colors.dim}
          maxLength={24}
        />
      ) : (
        <Text style={s.title}>{block.label}</Text>
      )}
      <View style={s.timesRow}>
        <TimeField value={block.start} onChange={(v) => set({ start: v })} />
        <Text style={s.dash}>–</Text>
        <TimeField value={block.end || block.start} onChange={(v) => set({ end: v })} />
      </View>
      <Text style={s.caption}>Which days?</Text>
      <DayToggle value={block.days} onChange={(days) => set({ days })} />
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 18, gap: 14 },
    title: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text },
    labelInput: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text, padding: 0 },
    timesRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dash: { color: colors.muted, fontSize: 18 },
    caption: { fontFamily: fonts.display, fontSize: 13, color: colors.muted, letterSpacing: 0.3 },
  });
}
```

- [ ] **Step 4: Verify bundle**

Run: `npx expo export --platform ios --output-dir /tmp/livenew-export-t8`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule package.json package-lock.json 2>/dev/null
git commit -m "feat(schedule-ui): DayToggle, TimeField, ActivityCard primitives"
```

---

## Task 9: ScheduleBuilder guided flow + onboarding wiring

**Files:**
- Create: `src/screens/onboarding/ScheduleBuilder.jsx`
- Modify: `src/screens/OnboardingScreen.jsx` (replace Step 1 essay)

- [ ] **Step 1: Build the flow component**

`ScheduleBuilder` props: `onComplete(schedule)`. Internal state: `stage` (`'triage' | 'activity' | 'wrap'`), `selectedTypes`, `blocks`, `cursor`. Triage offers a fixed set of types; each selected type becomes a default block the user times + day-toggles one card at a time; wrap confirms wake/meals and calls `onComplete(normalizeSchedule({ blocks, meals: DEFAULT_MEALS, wake, sleep }))`.

```jsx
// src/screens/onboarding/ScheduleBuilder.jsx
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import ActivityCard from '../../components/schedule/ActivityCard';
import { normalizeSchedule, DEFAULT_MEALS } from '../../domain/schedule.js';

const TYPES = [
  { type: 'work',    label: 'Work',             defaultDays: [0,1,2,3,4], start: '09:00', end: '17:00' },
  { type: 'school',  label: 'School',           defaultDays: [0,1,2,3,4], start: '08:00', end: '15:00' },
  { type: 'gym',     label: 'Gym / workouts',   defaultDays: [1,3,5],     start: '18:00', end: '19:00' },
  { type: 'kids',    label: 'Kids / caregiving',defaultDays: [0,1,2,3,4], start: '08:00', end: null },
  { type: 'commute', label: 'Commute',          defaultDays: [0,1,2,3,4], start: '08:00', end: '09:00' },
  { type: 'custom',  label: 'Something else',   defaultDays: [0,1,2,3,4], start: '12:00', end: null },
];

export default function ScheduleBuilder({ onComplete }) {
  const { colors, fonts } = useTheme();
  const s = makeStyles(colors, fonts);
  const [stage, setStage] = useState('triage');
  const [selected, setSelected] = useState([]); // type keys
  const [blocks, setBlocks] = useState([]);
  const [cursor, setCursor] = useState(0);

  const toggleType = (t) =>
    setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const startActivities = () => {
    let n = 0;
    const seeded = selected.map((t) => {
      const def = TYPES.find((x) => x.type === t);
      return { id: `b${n++}`, type: def.type, label: def.type === 'custom' ? '' : def.label,
               start: def.start, end: def.end, days: [...def.defaultDays] };
    });
    setBlocks(seeded);
    setCursor(0);
    setStage(seeded.length ? 'activity' : 'wrap');
  };

  const finish = () => onComplete(normalizeSchedule({ blocks, meals: DEFAULT_MEALS }));

  if (stage === 'triage') {
    return (
      <View style={s.wrap}>
        <Text style={s.iris}>What's in your week?</Text>
        <Text style={s.sub}>Tap what you've got — I'll only ask about those.</Text>
        <View style={s.chips}>
          {TYPES.map((t) => {
            const on = selected.includes(t.type);
            return (
              <Pressable key={t.type} onPress={() => toggleType(t.type)} style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={s.cta} onPress={startActivities}>
          <Text style={s.ctaText}>{selected.length ? 'Continue →' : 'Skip for now →'}</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === 'activity') {
    const block = blocks[cursor];
    const last = cursor === blocks.length - 1;
    return (
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.progress}>{cursor + 1} / {blocks.length}</Text>
        <Text style={s.iris}>When's {block.label || 'this'}?</Text>
        <ActivityCard
          block={block}
          editableLabel={block.type === 'custom'}
          onChange={(nb) => setBlocks((bs) => bs.map((b, i) => (i === cursor ? nb : b)))}
        />
        <Pressable style={s.cta} onPress={() => (last ? setStage('wrap') : setCursor((c) => c + 1))}>
          <Text style={s.ctaText}>{last ? 'Almost done →' : 'Next →'}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // wrap
  return (
    <View style={s.wrap}>
      <Text style={s.iris}>That's all I need.</Text>
      <Text style={s.sub}>☀ Wake & sleep — I read it from your phone.</Text>
      <Text style={s.sub}>🍽 Meals — usual times; tweak later only if yours differ.</Text>
      <Pressable style={s.cta} onPress={finish}>
        <Text style={s.ctaText}>See today's plan</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors, fonts) {
  return StyleSheet.create({
    wrap: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, gap: 16 },
    iris: { fontFamily: fonts.displayBold, fontSize: 28, color: colors.text, letterSpacing: -0.3 },
    sub: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, lineHeight: 23 },
    progress: { fontFamily: fonts.displaySemibold, fontSize: 13, color: colors.gold, letterSpacing: 1.5 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
    chipText: { fontFamily: fonts.displaySemibold, fontSize: 16, color: colors.muted },
    chipTextOn: { color: colors.gold },
    cta: { marginTop: 8, backgroundColor: colors.gold, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
    ctaText: { color: '#1a1612', fontFamily: fonts.displaySemibold, fontSize: 17 },
  });
}
```

> Icons: the triage chips use text here; during the UI/UX pass, prefix each with the crafted SVG icon (matching `FlameIcon`), not emoji. The wrap-step ☀/🍽 are placeholders to be replaced with SVG glyphs.

- [ ] **Step 2: Wire into OnboardingScreen Step 1**

In `src/screens/OnboardingScreen.jsx`, replace the Step 1 block (the routine `TextInput` + heading + hint, ~lines 374-403) with:

```jsx
{step === 1 && (
  <ScheduleBuilder
    onComplete={(schedule) => {
      setRoutine(''); // legacy field; store derives summary on save
      handleScheduleComplete(schedule); // advances onboarding, persists profile incl. schedule
    }}
  />
)}
```

Add `import ScheduleBuilder from './onboarding/ScheduleBuilder';` at the top. Implement `handleScheduleComplete(schedule)` to set the schedule onto the in-progress profile object and continue the existing onboarding progression (it should funnel into the same `saveProfileWithoutNav({ ...profile, schedule })` path used today by `handleScheduleNext`). Reuse the existing next-step logic; only the *input* changed.

- [ ] **Step 3: Verify bundle + manual run**

Run: `npx expo export --platform ios --output-dir /tmp/livenew-export-t9`
Expected: exit 0.
Manual (simulator/device): fresh onboarding → triage → one card per picked activity → wrap → first plan. No flicker; back works; "Something else" lets you type a label.

- [ ] **Step 4: Commit**

```bash
git add src/screens/onboarding/ScheduleBuilder.jsx src/screens/OnboardingScreen.jsx
git commit -m "feat(onboarding): guided schedule builder replaces routine essay"
```

---

## Task 10: Account editor + existing-user nudge

**Files:**
- Modify: `src/screens/AccountScreen.jsx`

- [ ] **Step 1: Add a Schedule entry that opens the builder**

Add a "Schedule" row under a section. On press, present `ScheduleBuilder` (as a modal screen or pushed route) seeded from the current `profile.schedule`; on complete, call the store's `saveProfile({ ...profile, schedule })` (the nav-flipping variant is fine here since the user is already onboarded). Register a `Schedule` screen in the Account/Today stack if a pushed route is preferred.

```jsx
// In AccountScreen render, within an existing card/section:
<Pressable style={s.settingRow} onPress={() => navigation.navigate('ScheduleEdit')}>
  <View style={s.settingContent}>
    <Text style={s.settingTitle}>Schedule</Text>
    <Text style={s.settingValue}>
      {profile?.schedule?.blocks?.length ? `${profile.schedule.blocks.length} blocks` : 'Set your week'}
    </Text>
  </View>
  <Text style={s.settingArrow}>›</Text>
</Pressable>
```

Add a `ScheduleEdit` screen to the navigator that renders `ScheduleBuilder` with `onComplete={(schedule) => { saveProfile({ ...profile, schedule }); navigation.goBack(); }}`.

- [ ] **Step 2: One-time nudge for users with no schedule**

For onboarded users whose `profile.schedule` is empty, show a single dismissible banner on Account (or Today) pointing to the Schedule editor. Gate it with an AsyncStorage flag `livenew:sched_nudge_dismissed` (scope by userId like the welcome flag: `livenew:sched_nudge_dismissed:<userId>`), so it never nags and never reappears for returning users who dismissed it.

- [ ] **Step 3: Verify bundle + returning-user check**

Run: `npx expo export --platform ios --output-dir /tmp/livenew-export-t10`
Expected: exit 0.
Manual: existing user (has routine, no schedule) → not re-onboarded, sees the nudge once; can build schedule from Account; sign out/in → no onboarding, schedule restored.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AccountScreen.jsx src/navigation/RootNavigator.jsx
git commit -m "feat(account): schedule editor + one-time setup nudge"
```

---

## Task 11: Final verification pass

- [ ] **Step 1: Run domain tests**

Run: `node scripts/schedule.test.js`
Expected: all four `... OK` lines, exit 0.

- [ ] **Step 2: Full iOS bundle**

Run: `npx expo export --platform ios --output-dir /tmp/livenew-export-final`
Expected: exit 0, `.hbc` produced.

- [ ] **Step 3: Returning-user non-regression (manual, REQUIRED by spec)**

On a device/simulator:
- New user: complete the builder → lands on Today with a tailored plan.
- Sign out → sign back in **online** → lands on Today, NOT the builder.
- Sign out → sign back in with the server unreachable (airplane mode after tokens cached) → still lands on Today (durable `livenew:onboarded:<userId>` marker), NOT the builder.
- Existing user with legacy routine, no schedule → never re-onboarded; plans still generate (routine fallback).

- [ ] **Step 4: Prompt quality spot-check (manual)**

Generate a plan for a user with a schedule on a weekday and on a weekend; confirm the plan references the day's actual commitments (e.g., gym on Sat, no school) and reads more tailored than the essay baseline.

- [ ] **Step 5: Commit any fixes, then finish the branch**

```bash
git add -A && git commit -m "test(schedule): final verification fixes" || true
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** guided flow (Tasks 8–9), data model + day convention (Tasks 1–2), resolveDaySchedule (Task 3), prompt rewrite (Task 5), server persistence + bootstrap (Task 6), store + derived routine + hasProfile preservation (Tasks 4,7), Account editor + migration nudge (Task 10), returning-user non-regression + aesthetics + prompt-quality acceptance (Tasks 9–11). Wake-relative zone re-timing is intentionally out of scope per spec §3.
- **Placeholder scan:** all code steps contain real code; the only deliberately-deferred polish (SVG icons replacing the ☀/🍽/chip text) is called out explicitly, not left as a silent TODO.
- **Type consistency:** `days` is `number[]` 0=Mon..6=Sun everywhere; `schedule` shape (`blocks/wake/sleep/meals/version`) is identical across `normalizeSchedule`, `resolveDaySchedule`, store, and server; function names (`dayIndex`, `normalizeSchedule`, `resolveDaySchedule`, `deriveRoutineSummary`) are used consistently across tasks.
