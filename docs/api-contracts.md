# ChainMove API Contracts

Every documented ChainMove endpoint is declared once in `lib/api/contracts.ts`
and built from that declaration with `defineRoute`. The generated OpenAPI
document lives at `docs/openapi/chainmove.openapi.json`.

- **[api-conventions.md](./api-conventions.md)** — how to add or change a route: envelopes, serialization, pagination, versioning, and what CI enforces.
- **[api-migration.md](./api-migration.md)** — response changes that affect existing clients.

## Quick reference

| Concern | Rule |
| --- | --- |
| Errors | `{ code, message, correlationId, fieldErrors? }`. `code` is stable; `message` is authored copy. Never a raw provider or database string. |
| Money | `{ currency, amountMinor, amountMajor }`. `amountMinor` is exact; use it for arithmetic. |
| Dates | ISO 8601 UTC (`2026-01-31T09:15:00.000Z`), or `YYYY-MM-DD` for calendar fields. |
| Pagination | `page` + `pageSize` (max 100); responses carry a `pagination` object. `limit` is a deprecated alias. |
| Serialization | Explicitly pick public fields. Returning a raw Mongoose document is rejected at runtime. |
| Auth | Session cookie for authenticated routes; webhook routes document their provider signature. |
| Versioning | `X-API-Version` header, date-based. Deprecations carry `Deprecation`/`Sunset` headers. |

## Commands

```bash
npm run openapi:generate   # regenerate the document after changing a contract
npm run openapi:check      # drift + backwards-compatibility checks (also run in CI)
npm test                   # contract and route-pipeline tests
```

Additive optional response fields are compatible. Removing a path, method, or
guaranteed response field, changing money units, narrowing accepted input, or
changing documented error behaviour is breaking and must be recorded in
`docs/openapi/approved-breaking-changes.json` with a reason and a migration
link.
