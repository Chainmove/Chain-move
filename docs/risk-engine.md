# Explainable risk engine

Risk evaluation is deterministic and versioned in `lib/risk/engine.ts`. Each
signal stores the exact rule version, plain-language explanation, event time,
evaluation time and evidence references. The deduplication key is stable across
live evaluation and replay.

Rules may only use documented platform behaviour. Protected attributes must
never be added to event attributes or rule configuration. Suppressions require
a reason and expiry. Persisted signals are immutable; a changed rule must use a
new version.

Historical replay must provide an inclusive time window and a maximum of 10,000
events per run. Store the last event ID externally to resume subsequent pages,
and persist signals with a unique index on `dedupeKey`.

Case queues should group open signals by subject and category, assign the
strictest severity, and use `calculateReviewDeadline` for the review SLA.
Normal queue responses should return evidence references, not underlying KYC or
payment documents. Decisions, assignments, notes and suppression changes must
also be written to the existing audit log.
