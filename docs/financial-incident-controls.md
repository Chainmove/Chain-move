# Financial incident controls

Call `evaluateOperationalControl` immediately before every server-side domain
mutation. A missing control store fails closed for the protected write. Reads,
login, support and history stay available. Accepted webhooks must first be
stored durably; paused downstream processing is retried and never discarded.

Controls are narrow by operation and optional provider. Global pause/read-only
changes require a second administrator. Every activation, bypass, expiry and
recovery must use the security audit log with actor, reason and incident ID.
Bypass is reserved for already-accepted idempotent completion.

Provider adapters own a `ProviderCircuitBreaker`. When open they queue durable
work and return the safe public error. After the recovery interval a single
half-open probe is allowed; success closes the breaker and failure reopens it.

## Recovery checklist

1. Confirm the incident owner and reconcile durable webhook/payment receipts.
2. Test the affected provider with a non-financial recovery probe.
3. Move from paused to degraded and monitor errors and duplicate protection.
4. Re-enable the narrow operation, record the approver, and close the incident.
