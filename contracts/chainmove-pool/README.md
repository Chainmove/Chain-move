# ChainMove Pool Contract

Prototype Soroban contract workspace for ChainMove pool ownership, investment, and repayment tracking.

This contract is prototype/testnet work only. It is not audited and must not be used with mainnet funds.

## Placeholder Features

- Create a pool owned by a Soroban address.
- Record an investor contribution to a pool.
- Record a repayment credited against an investor position and pool totals.
- Read pool state.
- Read an investor position.

## Idempotency Keys

Funding, repayment, and refund calls take an external `reference` string used
to make retries idempotent. The storage key for that receipt is derived from
a domain/version tag, the operation kind, the pool ID, and the participant
address, then hashed to a fixed-size digest (`DataKey::ScopedReference`).
This means the same external reference can be reused safely across unrelated
pools, operations, or actors, and no one can preempt another pool/actor by
guessing or reusing its reference. A duplicate call within the same scope
(same kind, pool, actor, and reference) with matching parameters still
returns the original result; matching reference with different parameters is
rejected as `DuplicateReference`.

Receipts written before this change live under the older, unscoped
`DataKey::Reference` key. Those are still honored for exact-scope replays,
but that key is never written to going forward.

## Local Commands

From the repository root:

```bash
cargo test
```

For optimized Soroban Wasm builds, install the Stellar CLI and run from this folder:

```bash
stellar contract build
```

