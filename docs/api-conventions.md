# ChainMove API Conventions

This is the contributor guide for adding or changing an HTTP endpoint. It
describes the contract layer in `lib/api/` and the rules CI enforces.

For the list of response changes that affect existing clients, see
[api-migration.md](./api-migration.md).

## The shape of a route

Every documented endpoint is declared once, in `lib/api/contracts.ts`, and built
from that declaration with `defineRoute`. The declaration is the single source
of truth: route behaviour, generated OpenAPI documentation, and the
compatibility baseline all derive from it.

```ts
// lib/api/contracts.ts
export const WalletSummaryResponseSchema = z.object({
  success: z.literal(true),
  wallet: z.object({ internalBalance: MoneySchema, walletAddress: z.string().nullable() }),
  transactions: z.array(WalletTransactionSchema),
})

export const apiContracts: ApiContract[] = [
  {
    operationId: "getWalletSummary",
    method: "GET",
    path: "/api/wallet/summary",
    tag: "wallet",
    summary: "Internal wallet balance and recent activity.",
    auth: "authenticated",
    response: WalletSummaryResponseSchema,
    errors: [400, 401, 403, 500],
  },
]
```

```ts
// app/api/wallet/summary/route.ts
export const GET = defineRoute({
  operationId: "getWalletSummary",
  method: "GET",
  auth: "authenticated",
  action: "wallet:read",
  resource: ({ user }) => ({ type: "wallet", ownerId: String(user._id) }),
  response: WalletSummaryResponseSchema,
  successStatus: 200,
  handler: async ({ user }) => {
    // Return a plain object. Throw for any failure.
    return { success: true as const, wallet: { ... }, transactions: [...] }
  },
})
```

The handler returns data or throws. It never builds a `Response`, never sets a
status code directly, and never catches an error only to re-wrap it as JSON.

## What the wrapper does

`defineRoute` runs a fixed pipeline so behaviour cannot drift between routes:

1. **Correlation id** — reuses an inbound `x-correlation-id` / `x-request-id`, or generates one.
2. **Version** — resolves `X-API-Version`; an unknown value is rejected with `UNSUPPORTED_API_VERSION`.
3. **Path params** — validated against `params`. A malformed segment returns `404`, not `400`, so id formats are not confirmed to unauthenticated callers.
4. **Authentication** — `auth: "authenticated"` resolves the session; no user means `401`.
5. **Authorization** — `roles` for a simple allow-list, `action` + `resource` to defer to the policy engine in `lib/authorization/policy.ts`.
6. **Query** — validated against `query`; failures return field-level errors.
7. **Body** — content type checked, JSON parsed (`MALFORMED_JSON` on failure), then validated against `body`.
8. **Handler** — runs.
9. **Response** — parsed through the `response` schema, which **strips every undeclared key**, then checked for forbidden fields and raw Mongoose documents.
10. **Headers** — `X-API-Version`, `X-Correlation-Id`, and any deprecation headers.

Anything thrown at any stage goes through `normalizeError` and comes back as the
standard envelope.

## Error envelope

All errors share one shape:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Invalid request body.",
  "correlationId": "8f14e45f-ceea-467a-9f6a-1c2d3e4f5a6b",
  "fieldErrors": [
    { "path": "amountNgn", "message": "Number must be greater than 0", "code": "too_small" }
  ]
}
```

- `code` is a stable machine value from `API_ERROR_CODES`. Clients branch on it. A code may be **added**, never renamed or repurposed.
- `message` is authored, client-safe copy. It is safe to display.
- `correlationId` also appears in the `X-Correlation-Id` header and in server logs.
- `fieldErrors[].path` uses dot and bracket notation (`pool.contributions[0].amount`), or `root` for whole-payload failures.
- `issues` is a deprecated alias for `fieldErrors`, retained for existing clients.

### Raising errors

Throw an `ApiError`. Its message is the only message that ever reaches a client:

```ts
throw ApiError.notFound("Pool not found.")
throw ApiError.unprocessable("Your wallet balance is not enough.", [
  { path: "amountNgn", message: "Exceeds available balance." },
])
throw new ApiError("UPSTREAM_PROVIDER_ERROR", {
  message: "The payment provider could not start this transaction.",
  cause: providerPayload,     // logged, never serialized
  logContext: { reference },  // logged, never serialized
})
```

Anything else that escapes a handler — a `TypeError`, a driver error, a provider
rejection — becomes a generic `INTERNAL_ERROR` with its message discarded.
**This is deliberate.** Raw messages carry connection strings, index names,
provider payloads, and record ids. `normalizeError` recognizes a few shapes
automatically:

| Thrown value                                     | Result                        |
| ------------------------------------------------ | ----------------------------- |
| `ApiError`                                        | passed through                |
| `ZodError`                                        | `VALIDATION_FAILED` (400)     |
| object with `apiErrorCode`                        | that code, message forwarded  |
| Mongo transient / `TransientTransactionError`     | `TRANSIENT_CONFLICT` (503)    |
| Mongo duplicate key (`11000`)                     | `CONFLICT` (409)              |
| Mongoose `ValidationError`                        | `VALIDATION_FAILED` (400)     |
| anything else                                     | `INTERNAL_ERROR` (500)        |

A service error opts into client-visible mapping by carrying an `apiErrorCode`.
Having a `statusCode` is **not** sufficient — that would let any upstream
library publish its own text.

### Not-found over forbidden

When the policy engine denies access with `conceal: true` — an ownership
mismatch, or a resource that does not exist — the response is `404`, not `403`.
A `403` would confirm the resource exists and belongs to someone else.

## Serialization

### Never return a document

Handlers must map database records through an explicit serializer that picks
public fields. Returning a document ships every schema field, including ones
added later by an unrelated migration. Two mechanisms enforce this: the response
schema strips undeclared keys, and `assertNoRawDocuments` rejects any payload
still holding a hydrated document or `ObjectId`.

Put reusable serializers in `lib/api/serializers/`.

### Money

Monetary values use the canonical `Money` shape:

```json
{ "currency": "NGN", "amountMinor": 4500000, "amountMajor": 45000 }
```

`amountMinor` is an exact integer and is the only field safe for arithmetic.
`amountMajor` is a display convenience. Build values with `money(major)` or
`moneyFromMinor(minor)`; never hand-roll the object, and never publish a bare
`amountNgn` number on a new endpoint.

### Dates

ISO 8601 UTC with millisecond precision (`2026-01-31T09:15:00.000Z`) via
`serializeDateTime`. Calendar-only fields use `YYYY-MM-DD` via `serializeDate`.
Both return `null` rather than `"Invalid Date"` for unparsable input.

### Forbidden fields

`FORBIDDEN_RESPONSE_FIELDS` in `lib/api/serialization.ts` lists names that must
never appear in a response or in generated documentation — credentials, keys,
tokens, card data, and national identifiers. The guard runs on every response
and on every published example. If you need one of these names for an unrelated
purpose, rename your field.

## Pagination and filtering

List endpoints use `page` (1-based) and `pageSize` (default 20, max 100).
`limit` is accepted as a deprecated alias and triggers a `Warning` header.

Responses carry a `pagination` object built by `buildPaginationMeta`:

```json
{ "page": 2, "pageSize": 20, "total": 55, "totalPages": 3, "hasNext": true, "hasPrevious": true }
```

Shared filter conventions:

- `search` — free text, max 120 characters.
- `from` / `to` — ISO date or date-time. A bare `to` date is inclusive of that whole day. An unparsable bound is a field error, never a silently ignored parameter.
- `sort` / `order` — build with `sortQuerySchema(fields, default)`. The field allow-list is mandatory so callers cannot sort on unindexed or private columns.

## Versioning and deprecation

The API is versioned by date through the `X-API-Version` header rather than a
URL prefix, so pinning does not churn every path. Supported values live in
`API_VERSIONS`; omitting the header selects `DEFAULT_API_VERSION`. Every
response reports the version that served it.

To deprecate an endpoint, add a `deprecation` notice to its contract:

```ts
deprecation: {
  since: "2026-02-01",
  sunset: "2026-08-01",
  migrationUrl: "https://chainmove.example/docs/api-migration",
  replacedBy: "GET /api/wallet/summary",
}
```

The wrapper then emits `Deprecation`, `Sunset`, `Link; rel="deprecation"`, and a
`Warning` header, and the operation is marked `deprecated` in the OpenAPI
document. Deprecated behaviour must keep working until its sunset date.

## Adding a route: checklist

1. Add request/response schemas and a contract entry to `lib/api/contracts.ts`.
2. Declare the route's policy in `lib/authorization/inventory.ts` (an undeclared handler fails the inventory test).
3. Build the handler with `defineRoute`, matching `operationId` to the contract.
4. Add a serializer under `lib/api/serializers/` if you return records.
5. Run `npm run openapi:generate` and commit the regenerated document.
6. Add contract tests covering validation failures, authorization, and redaction.
7. Run `npm run openapi:check` and `npm test`.

## What CI enforces

`npm run openapi:check` runs two scripts:

- **Drift** (`check-openapi-drift.ts`) regenerates the document and fails if it differs from the committed copy. Forgetting step 5 above fails here.
- **Compatibility** (`check-openapi-compat.ts`) diffs the generated document against `docs/openapi/baseline.openapi.json` and fails on any breaking change that is not recorded in `docs/openapi/approved-breaking-changes.json`.

The comparison is variance-aware, because the same edit is safe in one position
and breaking in the other:

| Change                                | Request (input) | Response (output) |
| ------------------------------------- | --------------- | ----------------- |
| Add optional property                 | safe            | safe              |
| Add required property                 | **breaking**    | safe              |
| Remove property                       | **breaking**\*  | **breaking**\*\*  |
| Make optional property required       | **breaking**    | n/a               |
| Make required property optional       | safe            | **breaking**      |
| Add enum value                        | safe            | **breaking**      |
| Remove enum value                     | **breaking**    | safe              |
| Change type                           | **breaking**    | **breaking**      |
| Require a new security scheme         | **breaking**    | —                 |

\* when the schema is strict. \*\* when the property was required.

### Approving a breaking change

CI prints the approval id for each detected break. Record it:

```json
{
  "changes": [
    {
      "id": "removed-property POST /api/pools responses.201.pool.amountNgn",
      "reason": "Money moved to the canonical minor-unit representation.",
      "migrationUrl": "docs/api-migration.md#money-representation",
      "approvedOn": "2026-01-15"
    }
  ]
}
```

An approval requires a reason and a migration link, so no break ships
undocumented. After release, refresh the baseline:

```bash
cp docs/openapi/chainmove.openapi.json docs/openapi/baseline.openapi.json
```

Approvals that no longer match a detected change are reported as stale and
should be pruned.
