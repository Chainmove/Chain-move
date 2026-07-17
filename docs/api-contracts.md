# ChainMove API Contracts

ChainMove keeps public, authenticated, payment, admin, KYC, and webhook routes behind source-controlled contracts in `lib/api/contracts.ts`.

Run `npm run openapi:generate` after changing request or response schemas. CI runs drift and compatibility checks so generated artifacts stay reproducible. Additive optional response fields are compatible; removing paths, methods, required fields, changing money units, or changing documented error behavior requires a new version or deprecation window.

Conventions:

- Errors use `{ message, code?, issues? }` and must not expose secrets or raw database documents.
- Money values in contracts document whether they are NGN major values or minor units. New APIs should prefer `{ currency, amountMinor }`.
- Dates are ISO 8601 strings.
- Paginated routes use `page` and `limit` query parameters.
- Authenticated routes use the session cookie; webhook routes document provider signatures separately.
- Serializers must explicitly pick public fields instead of returning raw Mongoose documents.
