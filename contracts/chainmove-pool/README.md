# ChainMove Pool Contract

Prototype Soroban contract workspace for ChainMove pool ownership, investment, and repayment tracking.

This contract is prototype/testnet work only. It is not audited and must not be used with mainnet funds.

## Placeholder Features

- Create a pool owned by a Soroban address.
- Record an investor contribution to a pool.
- Record a repayment credited against an investor position and pool totals.
- Read pool state.
- Read an investor position.

## Local Commands

From the repository root:

```bash
cargo test
```

For optimized Soroban Wasm builds, install the Stellar CLI and run from this folder:

```bash
stellar contract build
```

