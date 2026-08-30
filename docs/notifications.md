# Notification domain

## Event taxonomy

Producers publish versioned events and never call email providers. Version 1 covers funding, investment confirmations, repayments, KYC decisions, payouts, arrears, and contract changes. `eventId` is a stable business-event ID. Payloads contain display-safe labels only—never KYC documents, secrets, bank details, or full financial records.

## Preference matrix

| Category | In-app | Email | Mandatory |
| --- | --- | --- | --- |
| Funding | On | On | No |
| Investment | On | On | No |
| Repayment | On | On | Due notices |
| KYC | On | On | Decisions |
| Payout | On | On | Status changes |
| Arrears | On | On | Yes |
| Contract | On | On | Yes |

Mandatory operational notices ignore disabled preferences. Preference links use signed, expiring tokens scoped to one user, category, and email channel; they do not grant account access.

## Template rules

Templates are keyed by event type and integer version. Rendering is deterministic, validates payloads, escapes HTML, and falls back to English while remaining locale-ready. Links use `NEXT_PUBLIC_APP_URL`, require HTTPS outside localhost, and accept internal paths only. Messages direct users to authenticated pages for sensitive details.

## Delivery lifecycle

`publishNotificationEvent` creates one `NotificationDelivery` per channel. The unique `{eventId}:{userId}:{channel}` key makes duplicate events harmless. In-app delivery is independent of email. Email progresses `scheduled → processing → delivered`; failures retry with exponential backoff and enter `dead_letter` after five attempts. Attempts retain timestamps, provider IDs, and redacted errors. A scheduler calls `POST /api/notifications/process` with `Authorization: Bearer $NOTIFICATION_WORKER_SECRET`.

User notification reads are user-scoped; admins may inspect a specified user. Delivery history and dead letters are operational data and must only be exposed to authorized admins.

## Read-state store

The `Notification` collection is the single source of truth for notification content and read state. `GET /api/activity` derives every unread count from it, and `PATCH /api/activity` (`set-read` and `mark-all-read`) is the only way that state changes, so a mutation response and the next read always agree.

The embedded `User.notifications` array is deprecated. Nothing writes to it, it has no schema default, and it is `select: false`, so no query returns it by accident and no user document grows one. `/api/auth/me` no longer projects or returns it, and unread badges come from `ActivityUnreadBell`, which fetches the live count and listens for `chainmove:activity-count-changed`.

### Retiring legacy embedded records

Documents written before the split was closed still carry the array. Retire them with:

```bash
bun run notifications:migrate-embedded -- --dry-run   # inventory only
bun run notifications:migrate-embedded                # backfill and unset
```

Each embedded entry is copied into the `Notification` collection and the array is then unset. Target IDs are derived deterministically — the ObjectId the old dual-write stored, otherwise a hash of owner, title, message and timestamp — so re-running never duplicates feed entries. Read state is merged in one direction: an embedded `read: true` promotes the collection document to read, because the retired server action recorded reads only on the embedded copy; an embedded `read: false` never un-reads a notification the user has since dismissed. A user whose entries did not all migrate keeps its array so the next run can finish the job.
