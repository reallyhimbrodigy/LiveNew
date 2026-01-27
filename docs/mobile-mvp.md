# Mobile MVP scope (Authorization-only)

This MVP targets 5 screens and uses the portable API contract (no cookies required).

## Global requirements

- Send `Authorization: Bearer <accessToken>` on authenticated requests.
- Do not rely on cookies.
- Errors follow `{ ok:false, error:{ code, message, field?, requestId } }`.

## Screens and API usage

### 1) Auth

- `POST /v1/auth/request` `{ email }`
- `POST /v1/auth/verify` `{ email, code }` -> store `accessToken`, `refreshToken`
- `POST /v1/auth/refresh` `{ refreshToken }`

Caching: none.

### 2) Today (home rail)

Primary call:

- `GET /v1/rail/today` -> `{ rail, day }`

Secondary calls:

- `GET /v1/citations` (cache for session)

Caching:

- Cache `rail/today` for a short window (e.g., 30-60s) and refresh on foreground.

### 3) Check-in

- `POST /v1/checkin` `{ checkIn }`
  - Required fields for the fast path: `stress`, `sleepQuality`, `energy`, `timeAvailableMin`

Behavior:

- After success, refetch `GET /v1/rail/today`.

### 4) Week

- `GET /v1/plan/week?date=YYYY-MM-DD` -> `{ weekPlan }`

Caching:

- Cache by `date` key; invalidate after check-in or force refresh.

### 5) Profile

- `POST /v1/profile` `{ userProfile }`
- `PATCH /v1/profile/timezone` `{ timezone, dayBoundaryHour? }`
- `GET /v1/changelog?audience=user&limit=5`
- Optional: `GET /v1/account/export`, `DELETE /v1/account` (with confirmations)

Caching:

- Profile can be cached locally; refetch on edit or session restore.

## Suggested screen flows

- Auth -> Today (`rail/today`)
- Today -> Check-in -> Today (refetch)
- Today -> Week (week plan)
- Today -> Profile (settings + notes)
