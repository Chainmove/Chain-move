# Financial idempotency retention

Funding, repayment, and refund references are financial operation receipts. A
reference is never treated as reusable merely because its on-chain storage entry
has expired.

## Policy

- The on-chain replay marker is retained for 180 days, with archive action due
  after 150 days. This bounds Soroban rent exposure.
- Each receipt preserves the original operation result, so a retry returns the
  original result rather than the current, subsequently changed position.
- Receipt events must be archived by the operator archive pipeline for seven
  years from their creation ledger. The archive is the authoritative source for
  late replay protection after the bounded on-chain marker expires.
- Before processing a late retry, an operator restores the archived compact
  receipt with `restore_reference`. Restoration is limited to the pool owner
  and is rejected after the seven-year financial retention deadline.

## Operator procedure

1. Poll `reference_retention_status` for references approaching the archive
   deadline; `archive_required` is the actionable signal.
2. Verify the immutable receipt event is present in the financial archive.
3. For a late retry whose marker is absent, restore the archived receipt before
   retrying the financial operation. The retry returns its original result and
   performs no transfer.
