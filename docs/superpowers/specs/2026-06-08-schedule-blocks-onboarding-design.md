# Schedule blocks — guided, day-aware routine capture

**Date:** 2026-06-08
**Status:** Approved design — ready for implementation plan
**Owner:** Zac

## 1. Problem

The onboarding "routine" step is the worst part of the app and the biggest conversion killer. Today it's a single free-text box — *"What does a typical day look like?"* (`src/screens/OnboardingScreen.jsx:374–403`) — that demands an essay before the user has felt any value.

It also has a correctness flaw the founder identified: a static routine is **wrong whenever a day deviates.** "I have school" is false on Saturday; "gym at 6" is false on rest days. No capture *form* fixes this, because the thing being captured is itself day-variable.

But the routine can't simply be removed or thinned: the routine string is what gives the plan-generation AI the context that makes plans genuinely tailored. Strip it to a one-liner or a couple of taps and the output degrades to generic cortisol/meditation advice — worthless and non-retaining. **Tailoring quality is bounded by context, and on an iPhone we cannot sense the schedule** (Apple Health is rich only for Apple Watch users; iPhone-only is essentially step count). So we must *collect* the schedule — the real job is collecting a **rich, day-accurate** schedule **without it feeling like work, and without making the user author seven separate days.**

## 2. Goals

- Replace the free-text essay with a **guided, one-question-at-a-time** capture flow that feels fast (well under a minute) and never shows a scrollable form.
- Produce a **rich, structured, day-accurate** schedule: the AI knows what each *specific* day holds (school Monday, gone Sunday).
- Capture activities **once** and assign them to days via toggles — never "write a schedule for every day."
- Keep wake/sleep and meals near-effortless (auto from Health when possible; sensible defaults otherwise).
- **Rewrite the plan prompt** to consume the structured, day-resolved schedule so output is demonstrably more tailored than today.
- Be **aesthetically polished** (the new gold-on-dark/gradient/Manrope system), **bug-free / non-glitchy**, and **never shown to returning users.**

## 3. Non-goals (explicitly out of scope for this spec)

- **Wake-relative zone re-timing.** Shifting the 8 fixed cortisol clock-windows (`src/utils/score.js` `ZONE_HOURS`) — and the widget/notifications/live-activity that key off them — so they follow each day's wake time. Wake/sleep times *do* feed the prompt as context in this spec, but the zone clock-times and notification times are **unchanged** (so: no regression, but a late-wake weekend can still get an early-morning zone/notification). This is a meaningful cross-cutting change and gets its own spec as a fast-follow. Flagged here so it's a conscious decision, not a silent gap.
- Calendar / location ingestion. Eliminated: not universal on iPhone.
- A daily "what kind of day is it?" question. We stay within the existing 3-question daily check-in budget.

## 4. Key decisions (rationale captured from brainstorming)

- **Collect, don't avoid.** Every route to avoiding/sensing the schedule was eliminated (sensing too weak on iPhone; thin input → generic). The schedule is the product's value; we collect it.
- **Activities once, toggled across days.** Resolves "rich + day-accurate + not 7 schedules" simultaneously.
- **Guided wizard, not a form.** One decision per screen, framed as Iris asking, with a short progress indicator — same data, a fraction of the perceived effort.
- **Wake/sleep:** auto from Health for Watch/sleep-tracking users (real, daily, varies naturally); a one-tap *typical* value (with weekend variant) for everyone else, nudged by the existing morning check-in. Honest caveat: a random off-night for a non-Watch user isn't captured; the cortisol curve tolerates ±~1h, so this is a small fidelity gap, not a tailoring gap.
- **Meals:** universal-enough to default (≈08:00 / 12:30 / 19:00), editable only if odd. Not part of the guided flow beyond an optional confirm.

## 5. UX design — the guided flow

Replaces onboarding Step 1. Framed as Iris. Matches the new visual system (gradient background, gold accents, Manrope, crafted SVG icons — **not emoji**, consistent with the `FlameIcon` decision). One question per screen, smooth slide transitions, short progress indicator.

**Step 1 — Triage (one tap-screen).** Pick what's in your week; we only drill into what's selected.
```
Iris: What's in your week?  (tap all that apply)
  ○ Work   ● School   ● Gym   ○ Kids/caregiving   ○ Commute   ○ + Something else
  [ Continue → ]
```

**Step 2 — One card per selected activity** (and nothing else). Progress shown.
```
Iris: When's gym?            ●●○
  Time   [ 6:00p ]–[ 7:00p ]
  Which days?   M  T  W  T  F  S  S   (tap to toggle)
  [ Next → ]
```
- "Something else" → same card with a free **label** field (e.g., "Choir", "Night shift").
- End time optional (some anchors are points in time, e.g. "school run 8:00").

**Step 3 — Wrap.** Wake/sleep + meals are handled automatically; confirm-only.
```
Iris: That's all I need.
  ☀ Wake & sleep — read from your phone (or a one-tap typical).
  🍽 Meals — usual times; tweak later only if yours differ.
  [ See today's plan ]
```

**Value reinforcement:** today's plan should visibly reference a block (e.g., *"built around your 6pm gym"*) so the user feels the tailoring pay off.

## 6. Data model

Stored in the existing `user_profile.constraints_json` (server) and mirrored in the client profile, alongside the current `routine`/`wakeTime` fields.

```jsonc
constraints.schedule = {
  version: 1,
  blocks: [
    {
      id: "uuid",
      type: "work" | "school" | "gym" | "kids" | "commute" | "custom",
      label: "Gym",          // user-facing; for custom, user-entered
      start: "18:00",        // "HH:MM" 24h
      end: "19:00" | null,   // null = point-in-time anchor
      days: [1, 3, 5]        // see Day convention below (Tue/Thu/Sat example)
    }
  ],
  wake:  { source: "health" | "manual", weekday: "06:40", weekend: "09:10" | null },
  sleep: { source: "health" | "manual", weekday: "23:10", weekend: "23:30" | null },
  meals: { breakfast: "08:00", lunch: "12:30", dinner: "19:00" }  // defaults; editable
}
```

**Day convention (pin it to avoid the classic off-by-one bug):** `days` are integers **0 = Monday … 6 = Sunday**. A single helper converts JS `Date.getDay()` (0 = Sunday) to this convention and is the *only* place the mapping lives. Unit-tested explicitly.

**Backward-compat / derived routine string.** The existing onboarding-complete gate is `hasProfile = !!(profile && profile.routine)` (`src/store/authStore.js`). To avoid touching that invariant, completing the builder also **derives a human-readable `routine` summary string** from the blocks (e.g., *"Weekdays: work 9–5, gym Tue/Thu 6pm…"*) and stores it. `routine` thus remains a valid back-compat/summary field; `schedule` is the structured source of truth the prompt actually uses.

## 7. Day → plan-prompt resolution (the prompt rewrite)

A pure server function `resolveDaySchedule(schedule, date)` → today's facts:
```js
{
  weekdayName: "Saturday",
  commitments: [{ label, start, end }],   // only blocks whose `days` include today
  wake, sleep,                            // weekend vs weekday value for today
  meals
}
```

`src/domain/aiDayPlan.js` currently injects routine as *"My typical routine (a reference, not a constraint): {routine}"* (~lines 227–249). Replace with **today-resolved, authoritative** context:

> `Today is Saturday. On the schedule today: Gym 6–7pm. No work, no school. Wake ~9:10, sleep ~11:30, meals ~9:00/13:00/19:00.`
> Instruction changes from "reference, not a constraint" → **"Build the plan around today's real commitments and timing."**

Fallback: if `schedule` is absent (legacy user who hasn't built one), fall back to the existing `routine` free-text behavior unchanged.

## 8. Onboarding integration & returning-user safety (hard requirement)

This must **not** regress the returning-user onboarding bug already fixed.

- **New users:** the guided builder *is* the onboarding schedule step. On completion it calls the existing save path (`saveProfileWithoutNav` → `api.acceptConsent()` + `api.onboardComplete(profile)` in `src/store/authStore.js`), which now also carries `schedule`. Completion sets `hasProfile: true` **and** writes the durable account-scoped marker `livenew:onboarded:<userId>` (already implemented).
- **Persistence:** `schedule` is stored server-side in `constraints_json` (extend `api.onboardComplete` / `persist.updateOnboarding`) and returned by `buildSupabaseBootstrapPayload` so it rehydrates on every device/login.
- **Returning users skip it entirely.** `hasProfile` / server `uiState: "home"` gating is unchanged; bootstrap restores `schedule` (or the derived `routine`), so onboarding never reappears. Acceptance test: sign out → sign back in (online *and* with a failed-bootstrap/offline path) → lands on Today, never the builder.

## 9. Editing later (Account)

Add **Account → Schedule** that re-opens the same guided flow (or a compact block list with the same per-block time/days editor) so users can adjust their week anytime. This is also the entry point for **existing users** to build a schedule (see Migration) — surfaced via one gentle, dismissible one-time nudge, never a forced wall.

## 10. Migration / backward compatibility

- **Existing onboarded users** have `routine` (free text) but no `schedule`. They are **not** re-onboarded: `hasProfile` stays true, plans keep using their `routine` via the fallback in §7.
- They're offered the builder via the one-time nudge / Account. Building a schedule is purely additive.
- No destructive migration; `routine` is retained (now also serving as the derived-summary field for new users).

## 11. Aesthetics & quality requirements (acceptance criteria)

- **Looks:** new design system (gradient bg, gold accents, Manrope), crafted SVG icons (no emoji), one-question-per-screen with smooth slide transitions and a short progress indicator. Run through the UI/UX pass. Honors safe areas; 44pt touch targets; reduced-motion respected.
- **No bugs / not glitchy:** built test-first; back navigation, skipping an activity, editing, and "Something else" custom labels all handled; no flicker between steps; day-toggle state correct across the week (incl. the 0=Mon mapping unit test).
- **Returning users:** never see the builder (the §8 acceptance test must pass, online and offline-bootstrap paths).
- **Prompt quality:** before merge, run a real schedule through the rewritten prompt and confirm the plan references today's actual commitments and is more tailored than the essay baseline.

## 12. Affected components

- `src/screens/OnboardingScreen.jsx` — replace Step 1 essay with the guided triage→per-activity flow.
- New: `ScheduleBuilder` flow + reusable `BlockCard` / `DayToggle` / `TimeField` components (new design system, SVG icons).
- `src/store/authStore.js` — carry `schedule` through `saveProfile*`; derive `routine` summary; keep `hasProfile` + onboarded-marker behavior.
- `src/api.js` / server `onboardComplete` + `persist.updateOnboarding` — persist `schedule` in `constraints_json`.
- Server `buildSupabaseBootstrapPayload` — return `schedule` in the profile payload.
- New: `resolveDaySchedule(schedule, date)` (server domain) + the 0=Mon day-index helper (shared, unit-tested).
- `src/domain/aiDayPlan.js` — rewrite routine injection to today-resolved schedule (with legacy `routine` fallback).
- `src/screens/AccountScreen.jsx` — add **Schedule** editor entry; one-time nudge.

## 13. Open questions / honest caveats

- **Non-Watch wake/sleep** can't track random off-nights (accepted; small fidelity gap).
- **Wake-relative zone/notification re-timing** is deferred (§3) — confirm that's acceptable for v1, or pull it in.
- Exact set of triage activity types (Work/School/Gym/Kids/Commute/Other) — starting set; easy to extend.
