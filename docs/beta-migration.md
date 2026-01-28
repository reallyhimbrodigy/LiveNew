# LiveNew Beta Migration Plan

This document defines what data migrates from Alpha to Beta and the admin-only export/import stubs.

## Carry-over policy

- Consents: **yes**
- Snapshot pins: **yes** (re-pin if missing)
- Outcomes history: **yes**
- Experiments: **no** (reset)
- Community opt-in: **yes**
- Debug bundles: **no**

## Admin-only endpoints (stubs)

These endpoints are for internal migration tooling only and require admin authorization.

### Export

`GET /v1/admin/migration/export/:userId`

Returns:

```json
{
  "ok": true,
  "export": {
    "userId": "uuid",
    "generatedAtISO": "2026-01-28T12:00:00.000Z",
    "consents": {},
    "snapshotPins": [],
    "outcomesHistory": [],
    "communityOptIn": false,
    "experiments": null,
    "debugBundles": null
  }
}
```

### Import

`POST /v1/admin/migration/import`

Body:

```json
{
  "userId": "uuid",
  "consents": {},
  "snapshotPins": [],
  "outcomesHistory": [],
  "communityOptIn": false,
  "experiments": null,
  "debugBundles": null
}
```

Notes:

- Import writes are idempotent.
- Unknown or unsupported fields are ignored.
