# Mobile MVP scope

## Global requirements
- Auth: `Authorization: Bearer <accessToken>` on every request.
- No cookies required or expected.
- CSRF is ignored for Authorization-based requests.
- Error shape:
  ```json
  {"ok":false,"error":{"code":"...","message":"...","field":"...","requestId":"..."}}
  ```

## Screen: Auth
Purpose: request and verify access, refresh tokens.

Endpoints:
- `POST /v1/auth/request` body `{ email }`
- `POST /v1/auth/verify` body `{ email, code }`
- `POST /v1/auth/refresh` body `{ refreshToken }`

Headers:
- `Authorization` not required for request/verify.
- Optional `x-device-name` (string).

Caching:
- No caching.

Errors:
- `rate_limited_auth`, `code_invalid`, `auth_locked`.

## Screen: Today
Purpose: default daily rail and day contract.

Endpoints:
- `GET /v1/rail/today`
- `GET /v1/plan/day?date=YYYY-MM-DD` (optional for explicit date)

Headers:
- `Authorization` required.

Caching:
- Cache the response for the current day; invalidate after a check-in or completion.

Errors:
- `consent_required` (must complete consent screen).
- `feature_disabled` if engine features are paused.

## Screen: Check-in
Purpose: send a quick or full check-in.

Endpoints:
- `POST /v1/checkin` body `{ checkIn }`

Headers:
- `Authorization` required.

Caching:
- Invalidate today’s cached day/rail after success.

Errors:
- `checkin_invalid`, `feature_disabled`.

## Screen: Week
Purpose: weekly plan overview.

Endpoints:
- `GET /v1/plan/week?date=YYYY-MM-DD`

Headers:
- `Authorization` required.

Caching:
- Cache per week; invalidate on check-ins or signals.

Errors:
- `consent_required`.

## Screen: Profile
Purpose: profile edits, privacy settings, and release notes.

Endpoints:
- `POST /v1/profile` body `{ userProfile }`
- `PATCH /v1/profile/timezone` body `{ timezone, dayBoundaryHour }`
- `PATCH /v1/account/privacy` body `{ dataMinimization }`
- `GET /v1/account/export`
- `GET /v1/changelog?audience=user&limit=5`

Headers:
- `Authorization` required.

Caching:
- No caching for edits. Cache changelog for 24h.

Errors:
- `profile_invalid`, `timezone_invalid`.
