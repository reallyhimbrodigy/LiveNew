# LiveNew Mobile Adapter Notes

## Auth
- Use `Authorization: Bearer <accessToken>` on every request.
- Access tokens expire quickly; refresh with `POST /v1/auth/refresh` using `{ refreshToken }`.
- Refresh rotation is enforced: always store the newest refresh token.
- No cookies required for mobile.

## CORS / CSRF
- Mobile clients should avoid cookies and use the Authorization header.
- CSRF checks are only required for cookie-auth flows.
- If you use `Authorization`, CSRF is not required.
- Configure `ALLOWED_ORIGINS` for browser clients; mobile can omit Origin.

## Core endpoints
- Day plan: `GET /v1/plan/day?date=YYYY-MM-DD`
- Week plan: `GET /v1/plan/week`
- Trends: `GET /v1/trends?days=7|14|30`
- Profile: `POST /v1/profile`
- Check-in: `POST /v1/checkin`
- Quick signal: `POST /v1/signal`
- Bad day: `POST /v1/bad-day`
- Completion: `POST /v1/complete`
- Feedback: `POST /v1/feedback`

## Data contracts
- DayContract is the primary surface for day view.
- Responses use `{ ok: boolean, ... }` and standardized error shape:
  `{ ok:false, error:{ code, message, field? } }`.

## Portability checklist
- All API calls work with Authorization headers only.
- Do not rely on cookies for session state.
- Avoid storing PII in client logs.
