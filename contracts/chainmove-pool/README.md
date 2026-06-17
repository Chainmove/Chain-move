# ChainMove Pool Soroban Contract

Prototype/testnet Soroban contract workspace for ChainMove pool ownership, investment recording, and repayment recording.

This contract is intentionally a scaffold. It is not audited, not production-ready, and should only be used for local development or testnet experiments.

## Placeholder API

- `create_pool(pool_id, owner, target_amount)`
- `record_investment(pool_id, investor, amount)`
- `record_repayment(pool_id, amount)`
- `read_pool_data(pool_id)`
- `read_investor_position(pool_id, investor)`

## Local Checks

From the repository root:

```bash
cargo test
```

From this contract folder:

```bash
cargo test -p chainmove-pool
cargo build -p chainmove-pool --target wasm32v1-none --release
```

The generated Wasm artifact is expected at:

```text
target/wasm32v1-none/release/chainmove_pool.wasm
```

