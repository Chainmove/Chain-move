# API Migration Guide

Response changes introduced when the contract layer landed, and what a client
must do about each. Conventions for new work live in
[api-conventions.md](./api-conventions.md).

First-party dashboards in this repository have already been updated. This guide
is for any other consumer — mobile clients, scripts, integrations — and as the
record of why each shape changed.

## 1. Error envelope

**Applies to:** every endpoint.

Errors previously varied by route: `{ "message": "..." }` on most, but
`{ "error": "Internal server error" }` on the ledger and investments routes, and
`{ "success": false, "code": "...", "message": "..." }` on the driver virtual
account route. All three are replaced by one envelope:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Invalid request body.",
  "correlationId": "8f14e45f-ceea-467a-9f6a-1c2d3e4f5a6b",
  "fieldErrors": [{ "path": "amountNgn", "message": "Number must be greater than 0", "code": "too_small" }]
}
```

**What still works:** `message` is present on every error, so a client reading
only `message` needs no change. `issues` remains as a deprecated alias for
`fieldErrors`.

**What breaks:** clients that read `error` as a *string*. The field no longer
exists; use `message`.

**What to adopt:** branch on `code` rather than parsing `message`. Codes are
stable; message copy is not. Log `correlationId` — it is also returned in the
`X-Correlation-Id` header and matches server logs.

Error messages are now authored copy only. Upstream provider text, database
errors, and stack traces are never forwarded. If you were surfacing the raw
message to end users, it is now always safe to display.

## 2. Money representation

**Applies to:** wallet summary, pools, pool investment, investments, ledger,
driver virtual account, payment initialization.

Bare NGN numbers are replaced by an explicit money object:

```jsonc
// before
{ "internalBalanceNgn": 45000 }

// after
{ "internalBalance": { "currency": "NGN", "amountMinor": 4500000, "amountMajor": 45000 } }
```

`amountMinor` is an exact integer in kobo and is the only field safe for
arithmetic. `amountMajor` is a display mirror. The `Ngn` suffix is gone from
response fields because the currency is now carried in the value.

**Request bodies are unchanged** — `amountNgn` is still the input field on
`POST /api/payments/initialize`, `POST /api/pools`, and
`POST /api/pools/{poolId}/invest`.

Field renames:

| Endpoint | Before | After |
| --- | --- | --- |
| `GET /api/wallet/summary` | `wallet.internalBalanceNgn` | `wallet.internalBalance` |
| `GET /api/wallet/summary` | `transactions[].amount` + `.currency` | `transactions[].amount` (money) |
| `GET /api/pools` | `assetPriceNgn`, `targetAmountNgn`, `minContributionNgn`, `currentRaisedNgn`, `remainingAmountNgn`, `userInvestedNgn` | `assetPrice`, `targetAmount`, `minContribution`, `currentRaised`, `remainingAmount`, `userInvested` |
| `POST /api/pools/{poolId}/invest` | `investment.amountNgn`, `currentRaisedNgn`, `targetAmountNgn`, `userBalanceNgn` | `investment.amount`, `currentRaised`, `targetAmount`, `userBalance` |
| `GET /api/driver/virtual-account` | `remainingBalanceNgn`, `nextPaymentAmountNgn` | `remainingBalance`, `nextPaymentAmount` |
| `GET /api/transactions/ledger` | `amount`, `amountOriginal`, `currency`, `originalCurrency` | `amount`, `originalAmount` (both money) |

## 3. Dates

All timestamps are ISO 8601 UTC with millisecond precision
(`2026-01-31T09:15:00.000Z`). Unparsable or absent values serialize as `null`
rather than `"Invalid Date"` or an omitted key.

## 4. Endpoint-specific changes

### `GET /api/wallet/summary`

Transaction `method` and `reference` are now explicitly `null` when absent
rather than omitted.

### `GET /api/investments`

Previously returned raw Mongoose documents, so every schema field — including
`__v` and any field added by a later migration — reached the client. It now
returns an explicit projection matching `models/Investment.ts`:

`id`, `investorId`, `loanId`, `vehicleId`, `amount`, `monthlyReturn`, `status`, `date`.

**What breaks:** `_id` is now `id`. Fields that were never on the model
(`expectedROI`, `paymentsReceived`, `totalPayments`, `startDate`) were always
absent and remain absent; they are simply no longer implied by the response.

### `GET /api/transactions/ledger`

- `metadata` is **removed**. It carried raw provider payloads — Paystack
  authorization objects, card metadata, caller IP addresses — straight to any
  authenticated caller. No first-party client rendered it. There is no
  replacement; open a request if you have a genuine need for a specific field.
- `pagination` gains `hasNext` and `hasPrevious` (additive).
- `type`, `status`, `reconciliation`, and `userType` query values are now
  validated against their documented enums. A value outside the enum was
  previously ignored; it is now a `400` with a field error.
- `userId` must be a 24-character hex id.
- `limit` is accepted as a deprecated alias for `pageSize` and returns a
  `Warning` header.

### `GET /api/admin/kyc-requests`

- Previously returned a **bare JSON array**. It now returns
  `{ success, requests, pagination }`. Read `payload.requests`.
- Paginated, 20 per page by default. Previously the whole table was returned.
- `_id` → `id`; `name` and `fullName` are collapsed into a single `name`
  (full name preferred); `kycRejectionReason` → `rejectionReason`;
  `kycDocuments` → `documentReferences`, alongside a new `documentCount`.
- `createdAt` is no longer returned.

Document references are still published on this admin-only endpoint because the
review workflow needs them to open each document. They are opaque handles, not
bearer capabilities — `GET /api/kyc-documents` authorizes every request
individually.

### `POST /api/payments/initialize`

Previously proxied the Paystack response body verbatim. It now returns a
ChainMove-shaped payload and no longer leaks provider fields:

```jsonc
// before
{ "status": true, "message": "Authorization URL created",
  "data": { "authorization_url": "...", "access_code": "...", "reference": "..." } }

// after
{ "success": true,
  "payment": { "authorizationUrl": "...", "accessCode": "...", "reference": "...",
               "amount": { "currency": "NGN", "amountMinor": 2500000, "amountMajor": 25000 } } }
```

- Success status is `201`, not `200`.
- The request field `amount` is removed; use `amountNgn`.
- A provider rejection is now `502 UPSTREAM_PROVIDER_ERROR` with authored copy,
  and an unreachable provider is `503 UPSTREAM_UNAVAILABLE`. Both were
  previously `500` carrying Paystack's own message.

### `GET /api/driver/virtual-account`

- The payload key `data` is now `virtualAccount`.
- `mockReference` and `testOnly` are removed. `isMock` remains.
- Provider failures map to `422` (caller can fix) or `502` (provider at fault)
  instead of forwarding Paystack's status and message.

### `GET|POST /api/fleet/documents`

- **These endpoints required no authentication at all.** They now require a
  session: `GET` needs `vehicle:read`, `POST` needs `vehicle:manage`
  (admin-only). Both policies were already declared in
  `lib/authorization/inventory.ts`; the handlers simply never enforced them.
- `GET` is now paginated (20 per page) and returns
  `{ success, documents, pagination }`. It previously returned every document.
- Documents are an explicit projection. `_id` → `id`, and **`fileUrl` is no
  longer returned** — it was a direct blob link that bypassed per-document
  authorization.
- `POST` validates its body against a schema; `documentType` must be one of the
  six documented values and dates must be parseable. Previously an unparsable
  date was stored as an `Invalid Date`.
- The error envelope changes from `{ success: false, error }` to the standard
  envelope.

### `POST /api/pools`

`assetType` must be `SHUTTLE` or `KEKE`. Previously any string was accepted and
failed deeper in the service with a `400` carrying the internal message.

### `POST /api/pools/{poolId}/invest`

Success status is documented as `201` (unchanged behaviour; the previous
OpenAPI document incorrectly said `200`). Service errors now map to specific
codes — `404` unknown pool, `409` closed pool, `422` insufficient balance,
`503` transient conflict — rather than a blanket `400` carrying the raw service
message.

## 5. Versioning

Requests may pin a version with `X-API-Version`. The only supported value today
is `2026-01-01`, which is also the default when the header is omitted. An
unrecognized value returns `400 UNSUPPORTED_API_VERSION`.

Every response carries `X-API-Version` and `X-Correlation-Id`. Deprecated
endpoints additionally carry `Deprecation`, `Sunset`, `Link; rel="deprecation"`,
and `Warning`. Watch for `Sunset` — behaviour is removed after that date.
