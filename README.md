# LiveNew

LiveNew is a Node.js + JavaScript service with a minimal web client and a deterministic event-driven domain engine.

## Requirements
- Node.js 22.x
- SQLite (via Node built-in `node:sqlite`)

## Environment variables
Required in production/alpha:
- `SECRET_KEY` – used to encrypt user email and session tokens at rest.

Optional:
- `PORT` – server port (default 3000)
- `DB_PATH` – SQLite database path (default `data/livenew.sqlite`)
- `ADMIN_EMAILS` – comma-separated list of admin emails
- `DEV_ROUTES_ENABLED` – `true` to enable `/v1/dev/*` routes
- `ALPHA_MODE` – `true` to force auth and disable dev routes
- `EVENT_SOURCING` – `true` to append user events
- `EVENT_RETENTION_DAYS` – event retention window (default 90)

## Run
```
npm start
```
Visit `http://localhost:3000` for the web client.

## Data export
Authenticated users can export their data:
```
GET /v1/account/export
```

## Data deletion
Authenticated users can delete all their data:
```
DELETE /v1/account
x-confirm-delete: DELETE
```
If `ALPHA_MODE=true`, include:
```
{"confirm":"LiveNew"}
```

## Admin
Admins are configured via `ADMIN_EMAILS` and can use `/v1/admin/*` endpoints and the Admin tab in the web client.
