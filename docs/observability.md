# Observability

Every API response includes `X-Correlation-Id`. Send that value in a subsequent
`X-Correlation-Id` request header to trace retries, webhooks, and background work.
Structured JSON logs use `timestamp`, `level`, `service`, `event`,
`correlationId`, `operationId`, `method`, `status`, and `durationMs`. Business
identifiers may be added as `transactionId`, `eventId`, `poolId`, or `jobId`.

`lib/observability/logger.ts` recursively redacts authorization and cookie values,
API keys, tokens, secrets, KYC fields, account/routing numbers, cards, and provider
payloads. Do not log a full request body; pass only allow-listed business IDs.
Logging is best-effort and cannot fail a request.

Metric names are low-cardinality: `http.requests`, `http.errors`, and
`http.duration`. Alert on elevated `http.errors:5xx`, sustained p95
`http.duration`, webhook failures, database failures, idempotency conflicts, and
job retry exhaustion. To investigate an incident, search the correlation ID, then
follow events ordered by timestamp; never paste redacted values back into tickets.

`GET /api/health` reports only application configuration readiness and has no
connection strings, secrets, or topology details. A `503` means configuration is
incomplete; it is safe for load balancer readiness checks.
