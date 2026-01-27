# LiveNew API Contract (Alpha)

This document defines the portable, Authorization-only contract for mobile and web clients.

## Auth model (no cookies required)

- Clients send `Authorization: Bearer <accessToken>` on every authenticated request.
- Access tokens are short lived. Refresh tokens are rotated on every refresh.
- Refresh flow:
  1) `POST /v1/auth/request` with `{ email }`
  2) `POST /v1/auth/verify` with `{ email, code }` -> returns `accessToken` and `refreshToken`
  3) `POST /v1/auth/refresh` with `{ refreshToken }` -> returns new tokens
- Cookie-based CSRF flows are dev-only. Authorization requests bypass CSRF.

## Error shape

All non-2xx responses return:

```json
{
  "ok": false,
  "error": {
    "code": "string_code",
    "message": "Human readable message",
    "field": "optional_field_name",
    "requestId": "uuid"
  }
}
```

In `ENV_MODE=dev|dogfood`, a `details` object may be included.

## Core endpoints used by clients

### Plan and explainability

- `GET /v1/rail/today` -> `{ ok, rail, day }`
- `GET /v1/plan/day?date=YYYY-MM-DD` -> `{ ok, day }`
- `GET /v1/plan/week?date=YYYY-MM-DD` -> `{ ok, weekPlan }`
- `GET /v1/plan/why?date=YYYY-MM-DD` -> `{ ok, dateISO, why, changeSummary }`
- `GET /v1/citations` -> `{ ok, citations }`

### Inputs and adaptation

- `POST /v1/checkin` with `{ checkIn }`
- `POST /v1/signal` with `{ dateISO, signal }`
- `POST /v1/complete` with `{ dateISO, part }`
- `POST /v1/plan/force-refresh` with `{ dateISO }`

### Profile and settings

- `POST /v1/profile` with `{ userProfile }`
- `PATCH /v1/profile/timezone` with `{ timezone, dayBoundaryHour? }`
- `GET /v1/account/export`
- `DELETE /v1/account` with header `x-confirm-delete: DELETE` and body `{ confirm: "LiveNew" }`
- `GET /v1/changelog?audience=user&limit=5`

## DayContract schema (stable fields)

Day-level payloads (`day`) follow this shape:

```json
{
  "dateISO": "YYYY-MM-DD",
  "what": {
    "workout": {
      "id": "w_strength_15",
      "title": "Strength basics",
      "minutes": 15,
      "window": "PM"
    },
    "reset": {
      "id": "r_breath_2",
      "title": "Two minute breath",
      "minutes": 2
    },
    "nutrition": {
      "id": "n_stabilize_plate",
      "title": "Stabilize your plate"
    }
  },
  "why": {
    "profile": "Balanced",
    "focus": "stabilize",
    "driversTop2": ["sleep_low", "stress_high"],
    "shortRationale": "Downshift today because sleep was low and stress is high.",
    "whyNot": ["Not intensity today because sleep quality was low."],
    "packMatch": {
      "packId": "balanced_routine",
      "score": 0.82,
      "topMatchedTags": ["strength", "stabilize"]
    },
    "confidence": 0.74,
    "relevance": 0.78,
    "whatWouldChange": [
      "Higher sleep quality would allow longer movement.",
      "More time available would increase the workout dose."
    ],
    "expanded": {
      "drivers": [],
      "appliedRules": [],
      "anchors": [],
      "safety": {},
      "rationale": []
    },
    "statement": "Today is about stabilizing energy and stress.",
    "rationale": [],
    "meta": {},
    "safety": { "level": "ok", "reasons": [] },
    "checkInPrompt": { "shouldPrompt": false, "reason": null }
  },
  "howLong": {
    "totalMinutes": 17,
    "timeAvailableMin": 20
  },
  "details": {
    "workoutSteps": [],
    "resetSteps": [],
    "nutritionPriorities": [],
    "anchors": {},
    "citations": ["sunlight_circadian"]
  }
}
```

Notes:

- Some plans intentionally set `workout` to `null` in safety blocks.
- `details.citations` contains citation ids. Resolve titles/links via `GET /v1/citations`.
- Clients should treat unknown fields as forward-compatible and ignore them.

## CORS requirements

- Server must set `ALLOWED_ORIGINS` to include the client origin(s).
- Allowed headers include:
  - `Authorization`
  - `Content-Type`
  - `X-Device-Name`
  - `X-Request-Id`
  - `X-Client-Type`
  - `X-CSRF-Token`
