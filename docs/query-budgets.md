# Cursor pagination and query budgets

High-traffic transaction and notification feeds use signed, expiring cursors
bound to the authenticated filter scope. Ordering is `(timestamp DESC, _id
DESC)`, preventing skips or duplicates when rows share timestamps. Tampered,
expired, version-mismatched, or cross-filter cursors are rejected.

Queries have bounded page sizes, field projections, compound indexes, and
MongoDB execution deadlines. Set `CURSOR_SIGNING_SECRET` independently from
session keys. Before deployment, run `explain("executionStats")` for representative
tenant/type filters and verify the new compound indexes are selected.
