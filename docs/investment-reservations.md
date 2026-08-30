# Pool investment reservations

The pool investment endpoint is a transactional command. Clients must send a stable
`Idempotency-Key` header for each intended investment; retries with the same key
return the already-settled investment instead of creating another position.

```text
PENDING -> RESERVED -> SETTLED
    |          |  \-> EXPIRED
    |          \----> CANCELLED | FAILED
    \---------------> CANCELLED | FAILED
```

Terminal states have no outgoing transitions. A transaction conditionally debits
the wallet, creates the settled investment and ledger record, and increments the
pool total. If any operation fails, MongoDB rolls all of those writes back. The
expiry worker only selects `RESERVED` records, so it cannot release a settled
investment:

```bash
npx tsx scripts/expire-investment-reservations.ts
```

Run that command from the scheduled worker at least once per reservation TTL.
