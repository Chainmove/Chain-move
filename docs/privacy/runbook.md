# Privacy operational runbook

This runbook is for on-call engineers and compliance staff. It describes
how to investigate, intervene in, and recover from privacy lifecycle
operations.

## User-facing endpoints

| Method | Path                                       | Purpose                                     |
| ------ | ------------------------------------------ | ------------------------------------------- |
| POST   | `/api/privacy/export/request`              | User requests a data export                 |
| POST   | `/api/privacy/export/[id]/confirm`         | User confirms the export                    |
| GET    | `/api/privacy/export/[id]/status`          | User checks status + archive metadata       |
| GET    | `/api/privacy/export/[id]/download`        | User downloads the encrypted archive        |
| POST   | `/api/privacy/deletion/request`            | User requests account deletion              |
| POST   | `/api/privacy/deletion/[id]/confirm`       | User confirms deletion (starts cooling-off) |
| POST   | `/api/privacy/deletion/[id]/cancel`        | User cancels before processing              |
| GET    | `/api/privacy/requests/[id]`               | User reads full request lifecycle           |

## Admin endpoints

| Method | Path                                  | Purpose                                  |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/api/admin/privacy/holds`            | List holds (filter `?status=`)           |
| POST   | `/api/admin/privacy/holds`            | Create a hold                            |
| DELETE | `/api/admin/privacy/holds/[id]`       | Release a hold                           |
| GET    | `/api/admin/privacy/audit?userId=...` | Audit log scoped to privacy actions      |

All admin endpoints require an `admin` session.

## CLI

```sh
npm run privacy:sweep   # advance cooling-off requests, expire archives + holds
```

## Common incidents

### "The user says they requested an export but didn't get a link"

1. Check `GET /api/admin/privacy/audit?userId=<id>` for `privacy.request.created`
   and `privacy.export.archive_created` events.
2. Confirm the request's status with `GET /api/privacy/requests/<id>`.
3. If the archive was created but the user didn't receive the link, they
   can fetch it via `/api/privacy/export/[archiveId]/status`. The link
   expires after `PRIVACY_EXPORT_ARCHIVE_TTL_HOURS` (default 7 days) —
   have them request a new export.

### "A deletion request is stuck in COOLING_OFF"

The cooling-off period defaults to 24h (`PRIVACY_COOLING_OFF_HOURS`).
`runPrivacySweep` (via `npm run privacy:sweep`) advances any request
whose `coolingOffEndsAt` has elapsed. Verify the cron is running. If a
manual advance is needed (e.g. to recover from a long cron outage),
call `advanceFromCoolingOff(requestId)` from a script.

### "A deletion is blocked by a hold"

1. Look up the user via `listActiveHoldsForUser(userId)`.
2. Confirm the hold is still relevant.
3. If the hold should be released, call `releaseLegalHold({ id, reason, actor })`
   or use `DELETE /api/admin/privacy/holds/[id]`. The reason is required
   for audit.
4. Re-run the deletion request — it will not automatically retry; the
   user must re-request or an admin must call `executeDeletionPipeline`
   directly.

### "An archive expired before the user downloaded it"

The archive has been wiped from disk. Have the user submit a new export
request — the system regenerates the archive on confirmation.

### "Cross-user data appears in an export bundle"

This **must** be reported immediately. Cross-user leakage is a P1
incident.

1. Stop the export pipeline (no further `confirmPrivacyRequest` calls).
2. Pull the bundle from disk using `decryptArchive({ archiveId, encryptionKey })`.
3. Run `findCrossUserLeaks(userId, bundle)` — it returns a list of
   sections where the user's `userId` field references another user.
4. If leaks are confirmed, file an incident and notify the user(s)
   whose data was leaked.
5. Fix the offending `PRIVACY_DATA_MAP` row, then call `sweepExpiredArchives`
   to wipe the leaked archive.

## Environment variables

| Variable                            | Required | Purpose                                 |
| ----------------------------------- | -------- | --------------------------------------- |
| `PRIVACY_EXPORT_ARCHIVE_KEY`        | yes      | AES-256 key for export archives         |
| `PRIVACY_EXPORT_ARCHIVE_KEY_VERSION`| no       | Key version label (default `v1`)        |
| `PRIVACY_EXPORT_ARCHIVE_DIR`        | no       | Directory for archive files             |
| `PRIVACY_EXPORT_ARCHIVE_TTL_HOURS`  | no       | Archive lifetime (default 168 = 7 days) |
| `PRIVACY_COOLING_OFF_HOURS`         | no       | Cooling-off period (default 24h)        |
| `PRIVACY_CONFIRMATION_TTL_MINUTES`  | no       | Confirmation token lifetime (default 60m)|
| `PRIVACY_PSEUDONYM_SALT`            | recommended | Salt for deterministic pseudonyms    |

## Recovery procedures

### Re-keying the archive encryption

1. Generate a new key. Keep the previous key for the duration of the
   archive TTL so existing archives remain decryptable.
2. Set `PRIVACY_EXPORT_ARCHIVE_KEY_VERSION` to the new version label.
3. Update `getArchiveKeyVersion()` and `decryptArchive()` to honor the
   keyring (this is a one-line change to the helper).
4. New archives use the new key; old archives use the previous key —
   the `encryptionKeyVersion` field on `PrivacyExportArchive` records
   which key each archive was encrypted with.
