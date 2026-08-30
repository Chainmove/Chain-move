# ChainMove Stellar Asset & Soroban Contract Design

> **Status:** Draft · **Target:** Stellar Testnet first, then Mainnet  
> **Audience:** Contributors implementing Stellar/Soroban integration  
> **Prerequisites:** See `docs/contributor-safety-and-stellar-roadmap.md` milestones 1-3

---

## Table of Contents

1. [Asset Model Overview](#1-asset-model-overview)
2. [Asset Code Strategy](#2-asset-code-strategy)
3. [Issuer & Distribution Account Model](#3-issuer--distribution-account-model)
4. [Soroban Contract Architecture](#4-soroban-contract-architecture)
5. [Pool Creation (Contract Interface)](#5-pool-creation-contract-interface)
6. [Investor Ownership Record (Contract Interface)](#6-investor-ownership-record-contract-interface)
7. [Repayment Recording (Contract Interface)](#7-repayment-recording-contract-interface)
8. [Payout Distribution (Contract Interface)](#8-payout-distribution-contract-interface)
9. [Treasury Authorization (Contract Interface)](#9-treasury-authorization-contract-interface)
10. [Governance Execution (Contract Interface)](#10-governance-execution-contract-interface)
11. [Horizon & RPC Indexing Strategy](#11-horizon--rpc-indexing-strategy)
12. [Offchain ↔ Onchain Data Mapping](#12-offchain--onchain-data-mapping)
13. [Security Assumptions & Risks](#13-security-assumptions--risks)
14. [Open Questions](#14-open-questions)
15. [Testnet vs Mainnet Separation](#15-testnet-vs-mainnet-separation)
16. [Glossary](#16-glossary)

---

## 1. Asset Model Overview

ChainMove uses **two layers** of onchain representation:

### Layer 1 — Stellar Issued Assets (token level)

Each **vehicle pool** is represented by a **Stellar issued asset** on the trustline model. Investors who contribute to a pool receive trustline access to that pool's asset, which encodes their fractional ownership.

> Pool assets are **not** freely tradable on the decentralized exchange (DEX) by default — transferability is gated by the pool's Soroban contract to enforce offchain KYC/AML and platform rules.

### Layer 2 — Soroban Contract State (program level)

Soroban contracts store:
- Pool metadata (vehicle type, target amount, status)
- Per-investor ownership records (address, units, basis points)
- Per-investor cumulative payout and repayment receipts
- Repayment schedules and applied amounts per driver
- Treasury authorizations and withdrawal limits
- Governance proposals and vote tallies
- Idempotency ledger for event ingestion

### Diagram

```
  Offchain (MongoDB)                    Onchain (Stellar)
  ┌─────────────────┐              ┌────────────────────────────┐
  │  InvestmentPool  │◄──────────►│  Pool Soroban Contract     │
  │  PoolInvestment  │◄──────────►│  ownership ledger          │
  │  DriverPayment   │◄──────────►│  repayment ledger          │
  │  InvestorCredit  │◄──────────►│  payout distribution       │
  │  PlatformSetting │◄──────────►│  treasury auth             │
  │  User (stellar)  │◄──────────►│  governance + votes        │
  └─────────────────┘              └────────────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │ Stellar Assets   │
                                   │ CMOVE | POOL-xxx │
                                   │ (trustlines)     │
                                   └─────────────────┘
```

---

## 2. Asset Code Strategy

### Option A — Single Platform Asset (`CMOVE`)

| Property | Value |
|----------|-------|
| Asset code | `CMOVE` |
| Issuer | Single ChainMove platform issuer account |
| Use case | Represents "platform ownership units" — fungible across pools |
| Trustlines | Every investor opens one trustline |
| DEX trading | Possible, but gated contract-side |
| Complexity | Lower — one asset to manage |

**Tradeoff:** Fungibility means all pools share the same asset code. Distinguishing which pool an investor owns requires querying the Soroban contract state.

### Option B — Per-Pool Asset Codes (`CMOVE:POOL-{ID}`)

| Property | Value |
|----------|-------|
| Asset code | `POOL-{4-char-id}` (max 12 chars per Stellar) or human-readable like `CMOVE-01` |
| Issuer | Per-pool issuer accounts **or** a single issuer with per-pool asset codes |
| Use case | Each vehicle pool is a distinct asset |
| Trustlines | One per-pool per investor (many trustlines) |
| DEX trading | Naturally isolated per pool |
| Complexity | Higher — asset lifecycle management, multiple trustlines |

### Recommendation for Testnet

Start with **Option A (`CMOVE`)** for Testnet:
- Single asset code `CMOVE` issued by the platform issuer account
- Pool identity is a `(issuer, assetCode, poolId)` tuple stored in the Soroban ownership contract
- Investors open one trustline to `CMOVE`
- Migration to per-pool codes can occur before Mainnet if the product requires isolated pool tradability

### Stellar Asset Code Constraints

- Length: 1–12 alphanumeric characters (`[A-Z][A-Z0-9]{0,11}`)
- Case-sensitive (Stellar recommends uppercase)
- If per-pool codes are chosen, ensure the code is deterministic from the pool ID (e.g., `CMOVE` + short hash prefix)

### `stellar.toml` Requirements

Before listing assets publicly on Mainnet:
- Publish `/.well-known/stellar.toml` at the platform domain
- Include each pool asset under `[[CURRENCIES]]`:
  - `code`, `issuer`, `display_decimals` (e.g., `7` for fractional units)
  - `name`, `desc`, `conditions`, `is_asset_anchored`, `anchor_asset_type`
  - `regulated` flag and `approval_server` if KYC gating is required

---

## 3. Issuer & Distribution Account Model

### Account Roles

| Account | Responsibility | Signer Model | Security |
|---------|---------------|-------------|----------|
| **Issuer** | Creates pool assets, manages trustlines, freezes if needed | Multisig (2-of-3 or 3-of-5) | Cold-key threshold; never in CI |
| **Distribution** | Holds asset float for operational disbursements | Platform server-signer (key in encrypted env) | Hot key; rotated regularly |
| **Treasury** | Receives platform fees, holds reserves | Multisig (2-of-3) | Medium-warm; governance-overridable |
| **Pool-specific (if per-pool)** | Manages one pool's asset issuance | Delegated from issuer | Optional; adds complexity |

### Lifecycle

1. **Issuer account** is created on Stellar Testnet (Mainnet later) with a minimum XLM balance
2. **Distribution account** is created and establishes a trustline to the issuer's pool asset
3. The issuer sends the pool's asset tokens to the distribution account at pool funding time
4. The distribution account allocates tokens to investor accounts on pool close
5. On repayment, tokens flow back through the distribution account or directly to investor trustlines

### Testnet-Only Simplifications

- Use a single Stellar account for both issuer and distribution (Funded via Friendbot)
- Soroban contract owner set to the same account
- All asset operations are manually verifiable on stellar.expert

### Mainnet Requirements

- Separate issuer, distribution, and treasury Stellar accounts
- Multisig on issuer: 2-of-3 with hardware signing for cold storage
- Distribution key stored encrypted in the platform's secret manager (not in `.env`)
- Treasury operations require a governance vote or admin multisig approval

---

## 4. Soroban Contract Architecture

### Deployment Plan

| Contract | Name | Responsibility | Testnet | Mainnet |
|----------|------|---------------|---------|---------|
| `pool_manager` | Pool Manager | Create pools, manage state | Single contract | Upgradeable proxy |
| `ownership` | Ownership Ledger | Record per-investor units | Same as pool_manager or separate | Separate |
| `repayment` | Repayment Ledger | Record driver payments, compute distributions | Same contract | Separate |
| `payout` | Payout Engine | Distribute repayments to investors | Same contract | Separate |
| `treasury` | Treasury Actions | Fee collection, reserve management | Same contract | Separate |
| `governance` | Governance | Proposal/vote execution | Same contract | Separate |
| `factory` | Factory | Deploy new pool instances | Optional | Recommended |

### Testnet Phase — Monolithic Contract

During Testnet iteration, a **single Soroban contract** (`pool_manager`) handles all responsibilities to reduce deployment complexity and cross-contract calls. The interface is organized into modules (see sections 5–10). This contract is **not upgradeable** on Testnet (redeploy on change).

### Mainnet Phase — Modular + Upgradeable

Split into separate contracts communicating via Soroban cross-contract calls. Each contract is deployed behind an **upgradeable proxy** (using Soroban's `Admin`/`Upgrade` pattern or a custom proxy).

### Contract Data Storage

Soroban contract data is stored as key-value pairs using `env.storage()`:

```rust
// Namespace prefixes for contract data keys
const POOL_PREFIX: Symbol = Symbol::new("pool");
const OWNER_PREFIX: Symbol = Symbol::new("owner");
const REPAYMENT_PREFIX: Symbol = Symbol::new("repay");
const PAYOUT_PREFIX: Symbol = Symbol::new("payout");
const TREASURY_PREFIX: Symbol = Symbol::new("treasury");
const GOV_PREFIX: Symbol = Symbol::new("gov");

// Example pool struct (serialized)
struct Pool {
    id: u64,
    asset_code: Bytes,
    issuer: Address,
    target_amount: i128,    // in stroops (1 XLM = 10_000_000 stroops)
    min_contribution: i128,
    status: u32,            // 0=Open, 1=Funded, 2=Closed
    investor_count: u32,
    created_at: u64,
}
```

---

## 5. Pool Creation (Contract Interface)

### `create_pool`

Creates a new vehicle pool and (optionally) issues the pool's onchain asset.

```rust
fn create_pool(
    env: Env,
    admin: Address,            // authorized admin address
    asset_code: String,        // e.g., "CMOVE" or "POOL-A1B2"
    target_amount: i128,       // in stroops
    min_contribution: i128,    // in stroops
    metadata_uri: String,      // offchain pointer to pool details (IPFS or platform URL)
) -> u64;                      // returns pool_id
```

**Preconditions:**
- `admin` must be an authorized treasury/admin address
- Pool ID is auto-incremented (Testnet) or deterministic (Mainnet)
- `target_amount` and `min_contribution` are in stroops (1 stroop = 0.0000001 XLM)

**Events emitted:**
```
PoolCreated(pool_id: u64, admin: Address, asset_code: String, target_amount: i128)
```

### `get_pool`

Reads pool state.

```rust
fn get_pool(env: Env, pool_id: u64) -> Pool;
```

### `update_pool_status`

Moves a pool through its lifecycle: `Open → Funded → Closed`.

```rust
fn update_pool_status(
    env: Env,
    admin: Address,
    pool_id: u64,
    new_status: u32,
);
```

**Events:**
```
PoolStatusUpdated(pool_id: u64, old_status: u32, new_status: u32)
```

---

## 6. Investor Ownership Record (Contract Interface)

### `contribute`

Records an investor's contribution to a pool and mints pool asset tokens to the investor's trustline.

```rust
fn contribute(
    env: Env,
    investor: Address,
    pool_id: u64,
    amount_stroops: i128,
) -> OwnershipReceipt;
```

**Postconditions:**
- `investor` record updated with contribution amount and basis points
- Pool asset tokens transferred (or escrowed) to `investor` address via trustline
- Pool's `current_raised` and `investor_count` updated

**Events:**
```
ContributionRecorded(pool_id: u64, investor: Address, amount_stroops: i128, units: i128)
```

### `get_ownership`

Returns an investor's holdings in a specific pool.

```rust
fn get_ownership(
    env: Env,
    pool_id: u64,
    investor: Address,
) -> Option<OwnershipRecord>;

struct OwnershipRecord {
    pool_id: u64,
    investor: Address,
    contributed_stroops: i128,
    ownership_bps: u32,       // basis points (1-10000)
    units: i128,              // pool asset token units held
    cumulative_payout: i128,  // total stroops paid out to this investor
    cumulative_repayment_share: i128, // total repayment share credited
}
```

### `get_investors`

Paginated list of investors in a pool.

```rust
fn get_investors(
    env: Env,
    pool_id: u64,
    cursor: u32,
    limit: u32,
) -> Vec<Address>;
```

---

## 7. Repayment Recording (Contract Interface)

### `record_repayment`

Record a driver repayment attributed to a vehicle pool.

```rust
fn record_repayment(
    env: Env,
    caller: Address,            // admin, driver, or automation account
    pool_id: u64,
    driver_id: Address,         // driver's Stellar address (or identifier)
    amount_stroops: i128,
    repayment_id: String,       // unique idempotency key (e.g., MongoDB ObjectId)
) -> RepaymentReceipt;
```

**Preconditions:**
- `repayment_id` must be unique (prevents double-recording from webhooks)
- `caller` must be authorized (admin or the contract's automation address)

**Events:**
```
RepaymentRecorded(pool_id: u64, driver_id: Address, amount_stroops: i128, repayment_id: String)
```

### `get_pending_distribution`

What repayments are queued but not yet distributed as payouts.

```rust
fn get_pending_distribution(
    env: Env,
    pool_id: u64,
) -> i128; // stroops awaiting distribution
```

### `get_repayment_history`

Returns repayment records for a pool or driver.

```rust
fn get_repayment_history(
    env: Env,
    pool_id: u64,
    driver_id: Option<Address>,
    cursor: u32,
    limit: u32,
) -> Vec<RepaymentRecord>;
```

---

## 8. Payout Distribution (Contract Interface)

### `distribute_payouts`

Distribute accrued repayments to pool investors proportionally.

```rust
fn distribute_payouts(
    env: Env,
    caller: Address,            // admin or automation account
    pool_id: u64,
) -> DistributionResult;
```

**Distribution logic:**
1. Read pending repayment total for the pool
2. For each investor, compute `investor_share = pending_total * investor.ownership_bps / 10000`
3. Transfer `investor_share` stroops from distribution account to investor's Stellar account
4. Update `cumulative_payout` for each investor
5. Zero the pending distribution balance

**Events:**
```
PayoutDistributed(pool_id: u64, total_amount: i128, investor_count: u32)
PayoutSent(pool_id: u64, investor: Address, amount: i128)
```

### `get_payout_history`

Returns payout records for an investor across a pool.

```rust
fn get_payout_history(
    env: Env,
    pool_id: u64,
    investor: Address,
    cursor: u32,
    limit: u32,
) -> Vec<PayoutRecord>;
```

### `get_unclaimed_payouts`

Returns pending payouts not yet withdrawn.

```rust
fn get_unclaimed_payouts(
    env: Env,
    investor: Address,
) -> i128;
```

---

## 9. Treasury Authorization (Contract Interface)

### Treasury commands manage platform-level funds: fees, reserves, and operational disbursements.

### `authorize_withdrawal`

Authorize a platform withdrawal from the treasury.

```rust
fn authorize_withdrawal(
    env: Env,
    admin: Address,             // must satisfy treasury auth threshold
    recipient: Address,
    amount_stroops: i128,
    reason: String,
    withdrawal_id: String,      // unique idempotency key
) -> bool;
```

**Events:**
```
WithdrawalAuthorized(withdrawal_id: String, recipient: Address, amount_stroops: i128)
```

### `execute_withdrawal`

Execute a previously authorized withdrawal.

```rust
fn execute_withdrawal(
    env: Env,
    caller: Address,
    withdrawal_id: String,
) -> bool;
```

### `set_treasury_admin`

Add or remove an admin address from the treasury authority set.

```rust
fn set_treasury_admin(
    env: Env,
    caller: Address,            // current admin
    target: Address,
    active: bool,               // true = add, false = remove
);
```

### `get_treasury_balance`

View treasury holdings.

```rust
fn get_treasury_balance(env: Env) -> i128;
```

### `withdraw_fees`

Platform fee withdrawal (revenue extraction).

```rust
fn withdraw_fees(
    env: Env,
    admin: Address,
    recipient: Address,
    amount_stroops: i128,
) -> bool;
```

---

## 10. Governance Execution (Contract Interface)

Governance covers proposals that change contract parameters, upgrade contracts, or execute admin-level actions through a voting process.

### `submit_proposal`

Create a new governance proposal.

```rust
fn submit_proposal(
    env: Env,
    proposer: Address,
    title: String,
    description: String,
    actions: Vec<GovernanceAction>,
    voting_deadline: u64,       // ledger sequence or timestamp
) -> u64;                        // proposal_id
```

**`GovernanceAction` types:**
- `UpdatePoolParam { pool_id, param, value }`
- `UpgradeContract { new_wasm_hash }`
- `TreasuryWithdrawal { recipient, amount }`
- `AddAdmin { address }`
- `RemoveAdmin { address }`
- `FreezePool { pool_id }`
- `UnfreezePool { pool_id }`

### `cast_vote`

Vote on an active proposal.

```rust
fn cast_vote(
    env: Env,
    voter: Address,
    proposal_id: u64,
    vote: bool,                 // true = yes, false = no
    voting_power: i128,         // weight (must match contract-calculated)
);
```

Voting power is proportional to the voter's total pool ownership (summed across all pools).

### `execute_proposal`

Execute an approved proposal after the voting deadline passes.

```rust
fn execute_proposal(
    env: Env,
    caller: Address,
    proposal_id: u64,
) -> bool;
```

**Preconditions:**
- Voting deadline has passed
- `yes_votes > no_votes` (simple majority)
- Quorum reached (e.g., minimum 10% of total voting power)
- Proposal not already executed

### `get_proposal`

Read proposal state.

```rust
fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal>;
```

### Governance Parameters

Configurable by admin (or governance itself):

| Parameter | Default (Testnet) | Description |
|-----------|-------------------|-------------|
| `voting_period` | 7 days | Duration proposals remain open |
| `quorum_bps` | 1000 (10%) | Minimum participation as bps of total voting power |
| `approval_threshold_bps` | 5000 (50%) | Minimum yes vote proportion |
| `min_proposal_deposit` | 100 XLM | Anti-spam bond (returned if proposal passes) |

---

## 11. Horizon & RPC Indexing Strategy

### Indexing Architecture

```
Stellar Network
     │
     ├── Horizon REST API ───┐
     │   (account payments,   │
     │    transactions, ops)   │
     │                        ├──► ChainMove Indexer Service
     │                        │    (cron job / background worker)
     │                        │    1. Poll Horizon for new ledgers
     │                        │    2. Filter relevant accounts/contracts
     │                        │    3. Idempotency check (ledger+op key)
     │                        │    4. Write to MongoDB
     │                        │    5. Fire domain events
     │                        │
     └── Soroban RPC ─────────┘
         (contract events,
          `getLedgerEntries`,
          `simulateTransaction`)
```

### What to Index

| Data Source | Data | Destination | Frequency |
|-------------|------|-------------|-----------|
| Horizon /accounts | Trustline changes, XLM balances | MongoDB `stellar_accounts` cache | Every 30s |
| Horizon /payments | Asset transfers, path payments | MongoDB `transactions` (Stellar type) | Every 30s |
| Horizon /operations | ManageBuyOffer, ManageSellOffer | MongoDB (if DEX used) | On event |
| Soroban RPC events | Contract events (pool, repayment, payout) | MongoDB `stellar_events` | Every 60s or on webhook |
| Soroban RPC `getLedgerEntries` | Contract data state | MongoDB cache | On demand |

### Idempotency Model

Each onchain event is uniquely identified by `(ledger_sequence, operation_index, event_type)`. The indexer skips records already present in the `stellar_events` collection (MongoDB unique compound index).

### Repayment Flow (End-to-End)

```
1. Driver pays via Paystack → webhook hits ChainMove backend
2. Backend records DriverPayment in MongoDB (status: CONFIRMED)
3. Backend calls record_repayment on the Soroban contract
4. Soroban contract emits RepaymentRecorded event
5. Indexer picks up the event → updates MongoDB investor_credits
6. Backend (or cron) calls distribute_payouts on contract
7. Soroban contract transfers pool assets → investors
8. Indexer records payout DistributionSent events → MongoDB
```

### Event / Webhook Alternatives

- **Polling** (recommended for Testnet): cron job polls Horizon and Soroban RPC every 30–60 seconds
- **Stellar Webhooks** (Mainnet): Consider using a Stellar ecosystem service or building a webhook receiver attached to a Horizon stream
- **MongoDB change streams**: Optionally notify dashboards in real time when indexed data arrives

---

## 12. Offchain ↔ Onchain Data Mapping

### InvestmentPool (MongoDB) → Pool (Soroban)

| MongoDB Field | Soroban Field | Notes |
|---------------|--------------|-------|
| `_id` | `pool_id` (u64) | Mapping stored in MongoDB or derived deterministically |
| `assetType` (SHUTTLE/KEKE) | `metadata_uri` or enum | Offchain metadata pointer |
| `assetPriceNgn` | Not stored onchain | Offchain fiat price |
| `targetAmountNgn` | `target_amount` (stroops) | Converted at pool creation rate |
| `minContributionNgn` | `min_contribution` (stroops) | Converted at pool creation rate |
| `status` (OPEN/FUNDED/CLOSED) | `status` (u32) | Mapped (0=Open, 1=Funded, 2=Closed) |
| `currentRaisedNgn` | Computed from contributions | Derived by summing `OwnershipRecord` stroops |
| `investorCount` | `investor_count` | Mirrored on contract |

### PoolInvestment (MongoDB) → OwnershipRecord (Soroban)

| MongoDB Field | Soroban Field | Notes |
|---------------|--------------|-------|
| `_id` | — | Used as `repayment_id` for idempotency |
| `poolId` | `pool_id` | — |
| `userId` | `investor` (Address) | Mapped from User.stellarPublicKey |
| `amountNgn` | `contributed_stroops` | Converted using rate at contribution time |
| `ownershipUnits` | `units` | Pool asset tokens minted |
| `ownershipBps` | `ownership_bps` | Direct mapping (1–10000) |
| `txRef` | — | Stored in offchain metadata |

### DriverPayment (MongoDB) → RepaymentRecord (Soroban)

| MongoDB Field | Soroban Field | Notes |
|---------------|--------------|-------|
| `_id` | `repayment_id` | Idempotency key |
| `contractId` | `pool_id` | Resolved via hire-purchase contract → pool |
| `driverUserId` | `driver_id` | Mapped from User.stellarPublicKey |
| `amountNgn` | `amount_stroops` | Converted |
| `appliedAmountNgn` | `amount_stroops` | Used for distribution calculation |
| `status` | — | Soroban only records confirmed payments |

### InvestorCredit (MongoDB) → PayoutRecord (Soroban)

| MongoDB Field | Soroban Field | Notes |
|---------------|--------------|-------|
| `_id` | — | — |
| `paymentId` | Links to `RepaymentRecord` | — |
| `investorUserId` | `investor` | Mapped from User.stellarPublicKey |
| `amountNgn` | `amount` (stroops) | Converted |
| `ownershipBps` | Matched from `OwnershipRecord` | Consistency check |

---

## 13. Security Assumptions & Risks

### Assumptions

| # | Assumption | Rationale |
|---|-----------|-----------|
| A1 | Platform backend controls all Stellar accounts marked as "distribution" | Required to automate payouts; mitigation: use low-balance operational accounts |
| A2 | Investors control their own Stellar private keys | Self-custody model; ChainMove never stores investor private keys |
| A3 | Soroban contract admin is the platform multisig | Single admin during Testnet, governance-controlled on Mainnet |
| A4 | Offchain MongoDB is the system of record for fiat amounts | Onchain records stroops; conversion rates are offchain |
| A5 | Repayment originates from offchain (Paystack) before hitting the chain | Fiat-to-stroop conversion happens server-side |

### Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Distribution private key compromise | Critical | Use short-lived distribution keys; rotate monthly; never store in CI; use env-specific keys |
| R2 | Issuer account frozen or locked | High | Multisig on issuer; separate from distribution; governance-overridable freeze |
| R3 | Soroban contract bug loses funds | Critical | Testnet fuzzing; audit before Mainnet; upgradeable proxy pattern; circuit breaker |
| R4 | Offchain ↔ onchain state divergence | High | Reconciliation cron job; alert on mismatch > 1%; manual override function guarded by multisig |
| R5 | Replay attack on `record_repayment` | Medium | Idempotency key (`repayment_id = MongoDB _id`); unique index on contract |
| R6 | Governance takeover | High | Quorum + approval threshold; time-locked execution on Mainnet; admin veto during transition |
| R7 | Oracle manipulation (conversion rate) | Medium | Use trusted offchain rate feed; log all conversions; rate sanity checks |
| R8 | Indexer falls behind | Medium | Alert if last indexed ledger is > 10 ledgers behind; backfill on restart |
| R9 | Trustline exhaustion (investor) | Low | UI prompts investor to establish trustline before contribution |
| R10 | Stellar network congestion | Low | Monitor `max_fee`; retry with backoff; offchain queue |

### Key Management Rules

- **Never store signing keys in source code, `.env.local`, or CI secrets** for Mainnet
- Testnet keys may be in `.env.local` for development convenience
- Distribution account keys stored encrypted in deployment environment variable store (Vercel/Infisical)
- Issuer keys are cold-signed (hardware wallet or offline) for all Mainnet operations
- Governance can rotate admin addresses on-chain, but timelock delays the rotation

---

## 14. Open Questions

These should be resolved before Mainnet deployment:

| # | Question | Decision Needed From | Impact |
|---|----------|---------------------|--------|
| Q1 | Single asset code (`CMOVE`) vs per-pool asset codes? | Product + Community | Affects trustline UX, DEX strategy, stellar.toml |
| Q2 | Should pool asset tokens be transferable between investors? | Legal + Product | If yes, requires DEX integration and KYC gating |
| Q3 | What is the fiat-to-stroop conversion rate model? | Finance | Fixed rate per pool (set at creation) vs floating |
| Q4 | Are there platform fees on payouts? If so, what rate? | Business | Affects `distribute_payouts` logic |
| Q5 | Governance: who is eligible to vote? All investors? Minimum holdings? | Community | Affects `VotingPower` computation |
| Q6 | Governance: what is the timelock period for executed proposals? | Security | Affects `execute_proposal` flow |
| Q7 | Should Soroban contracts be a monolith or modular on Mainnet? | Engineering | Affects contract architecture, upgrade cost, cross-call complexity |
| Q8 | What indexing service (if any) should be used for Mainnet? | Engineering | Self-hosted cron vs Stellar ecosystem event service |
| Q9 | How are distressed pools handled (e.g., driver defaults)? | Product + Legal | Affects pool status model, payout rules |
| Q10 | Is there a minimum investment lockup period? | Product | Affects `transfer` restrictions on pool assets |
| Q11 | Should repayment receipts be NFTs or non-transferable records? | Product | Affects `RepaymentReceipt` data model |
| Q12 | What is the disaster recovery plan if the Soroban contract needs to be paused or replaced? | Engineering | Emergency stop, proxy migration, data migration |
| Q13 | How does ChainMove handle Stellar account creation for investors who do not have one? | Product | Embedded wallet vs external wallet requirement |
| Q14 | What happens to the offchain fiat (NGN) when onchain stroop transfers revert? | Engineering | Offchain rollback, reconciliation |

---

## 15. Testnet vs Mainnet Separation

| Concern | Testnet | Mainnet |
|---------|---------|---------|
| **Network** | `https://horizon-testnet.stellar.org` + `https://soroban-testnet.stellar.org` | `https://horizon.stellar.org` + `https://soroban-mainnet.stellar.org` |
| **Asset code** | `CMOVE` | `CMOVE` (or per-pool codes) |
| **Issuer account** | Single account (Friendbot-funded) | Multisig cold-wallet |
| **Distribution account** | Same as issuer (for speed) | Separate hot-wallet, rotated regularly |
| **Soroban contract** | Single monolith, redeploy on change | Modular, upgradeable proxy |
| **Contract admin** | Platform dev key | Multisig → governance |
| **Signing keys** | `.env.local` (dev only) | Hardware wallet / secret manager |
| **stellar.toml** | Not required | Required (published at `/.well-known/stellar.toml`) |
| **Indexing** | Polling every 60s | Polling + webhooks |
| **Investor KYC** | Optional (sandbox only) | Required before trustline |
| **Audit** | None (internal review only) | Third-party security audit |
| **Governance** | Admin-only (no voting) | Fully onchain voting |
| **Emergency stop** | Backend-level pause | Contract-level circuit breaker |
| **Conversion rate** | Fixed (1 NGN = 1_000_000 stroops test) | Market-based or oracle-fed |

### Runtime Environment Detection

The Stellar config layer (`lib/stellar/config.ts`) reads `STELLAR_NETWORK` to switch between Testnet and Mainnet. Contract clients and the indexer use this value to:
- Target the correct Horizon/RPC endpoint
- Select the correct set of contract IDs
- Enable/disable governance voting UI
- Show appropriate network badges in the dashboard
- Block Mainnet contract writes when on Testnet config (and vice versa)

---

## 16. Glossary

| Term | Definition |
|------|------------|
| **Stroop** | Smallest unit on Stellar (1 stroop = 0.0000001 XLM) |
| **Trustline** | An account's declaration of trust in an asset issuer, required to hold a non-XLM asset |
| **Soroban** | Stellar's smart contract platform (Turing-complete, WASM-based) |
| **Pool asset** | Stellar issued asset representing fractional ownership in a vehicle pool |
| **Ownership basis points (bps)** | An investor's share of a pool, expressed as 1/10000th (e.g., 500 bps = 5%) |
| **Distribution** | Scrubbing repayments across pool investors proportional to ownership |
| **Idempotency key** | Unique identifier preventing duplicate onchain records of the same offchain event |
| **Multisig** | Stellar account requiring N-of-M signatures for operations |
| **Governance action** | An onchain operation submitted via proposal and executed after vote approval |
| **Factory contract** | A Soroban contract that deploys new contract instances |
| **Upgradeable proxy** | A contract pattern separating logic from state to allow upgrades |
| **Circuit breaker** | An emergency pause mechanism for smart contracts |
