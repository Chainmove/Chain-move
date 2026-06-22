# ChainMove

ChainMove is a mobility finance platform being positioned for the Stellar blockchain. It combines fractional vehicle ownership, pay-to-own driver financing, investor pool management, and operations tooling for a transport finance marketplace.

The repository currently contains the application layer: onboarding, authentication, internal wallets, pool investing flows, payment rails, dashboards, and backend APIs. The Stellar integration layer is the next major product milestone.

## Why ChainMove

Informal transport financing is still fragmented in many markets. Drivers face high daily settlement pressure, operators lack transparent records, and investors struggle to access structured, verifiable mobility assets.

ChainMove addresses that gap with:

- asset-backed investment pools for transport vehicles
- pay-to-own driver workflows with clearer repayment visibility
- wallet-enabled onboarding for non-technical users
- internal wallet and payment rails for recurring funding flows
- admin and reporting surfaces for platform operations
- a planned Stellar-backed record of ownership, repayments, payouts, and governance activity

## Why Stellar

Stellar is the intended blockchain home for ChainMove because its network model fits payment-heavy, asset-backed finance workflows:

- issued assets can represent vehicle pool interests, repayment receipts, or platform settlement instruments
- fast, low-cost payments are suitable for frequent contributions, repayments, and investor distributions
- Stellar Testnet provides a stable development path before moving production flows to Mainnet
- Horizon and Stellar RPC can support ledger reads, payment history, and smart contract interactions
- Soroban smart contracts can enforce ownership, payout, treasury, and governance logic
- Stellar anchors and ecosystem standards provide a path for regulated fiat on-ramps and off-ramps when the platform is ready

## Current Product Surface

The current codebase already supports a meaningful offchain and wallet-enabled product:

- investor flows for browsing pools, funding wallets, tracking positions, and viewing governance token screens
- driver flows for onboarding, repayment tracking, and ownership progression
- admin views for users, investors, reports, KYC, and fleet operations
- Privy-based authentication with embedded wallet provisioning
- Paystack-backed fiat funding into an internal NGN wallet
- Paystack dedicated virtual accounts for driver repayment collection
- MongoDB-backed APIs for pools, investments, transactions, and user state

## Stellar Alignment Note

This README reflects the target Stellar direction of the project.

### Wallet Abstraction Layer

The codebase now includes a wallet abstraction layer that separates authentication, application identity, and blockchain account management. This abstraction:

- Provides a clean API for wallet and account operations
- Supports multiple blockchain accounts per user (Stellar, EVM, embedded wallets)
- Allows seamless network switching between Stellar Testnet, Mainnet, and transitional chains
- Isolates EVM/Lisk-specific code for easier future removal
- Prepares the foundation for full Stellar wallet and transaction support

See `docs/WALLET_ABSTRACTION.md` for architecture details and `docs/MIGRATION_GUIDE.md` for usage examples.

### Current State

The full Stellar integration is not yet wired end-to-end in this repository. The app still contains temporary EVM-oriented wallet plumbing through `Privy`, `viem`, and Lisk Sepolia configuration, and `package.json` still includes non-Stellar chain dependencies. Those pieces are now isolated through the wallet abstraction and will be removed when the Stellar wallet, asset, and smart contract layer lands.

In practical terms:

- the product and backend foundations are here
- wallet abstraction layer provides structure for Stellar integration
- Stellar asset issuance, account flows, payout tracking, and Soroban contracts are the next chain layer
- README language, roadmap, and contribution guidance below are written for the Stellar path

### Wallet modes

Wallet and chain assumptions live in `lib/wallet/config.ts`; UI-facing wallet shapes live in
`lib/wallet/types.ts`.

- **Current mode — Privy embedded wallet:** Privy remains the authentication and embedded-wallet
  provider. New users receive an EVM wallet on Lisk Sepolia, preserving the existing signup,
  provider, and funding flows.
- **Planned mode — Stellar account:** a linked `stellarPublicKey` is displayed as a Stellar Testnet
  account in wallet/profile surfaces. This display path is separate from authentication and does
  not replace Privy.
- **No linked wallet:** public wallet display helpers return a neutral “Not linked” state instead
  of leaking chain-specific fallback assumptions into components.

When Stellar signing is introduced, add it behind the planned mode rather than changing Privy
authentication or scattering network constants through UI components.

## Tech Stack

- Next.js 16 with the App Router
- React 19
- TypeScript
- Tailwind CSS + Radix UI
- MongoDB + Mongoose
- Privy for current auth and embedded wallet onboarding
- Wallet abstraction layer for multi-chain account management
- Paystack for fiat payment flows
- Resend for email delivery
- Stellar SDK, Horizon, Stellar RPC, and Soroban planned for chain integration

## Architecture Overview

```text
[Next.js Frontend]
Investor + Driver + Admin dashboards
                |
                v
[Route Handlers / Domain Services]
Auth | Pools | Investments | Payments | Wallets | Reports
                |
                v
[MongoDB]
Users | Pools | Investments | Transactions | Operations data
                |
                v
[Stellar Integration Layer - planned]
Issuer accounts | Distribution accounts | Soroban contracts | Horizon/RPC reads
```

## Local Development

This repository contains both `package-lock.json` and `bun.lock`. `npm` is the safest default unless your team is standardizing on Bun.

1. Clone the repository:

```bash
git clone https://github.com/Obiajulu-gif/chain_move.git
cd chain_move
```

2. Install dependencies:

```bash
npm install
```

3. Create your local environment file from the safe contributor template:

```bash
cp .env.example .env.local
```

`.env.example` intentionally contains placeholder, localhost, and public testnet values only. Do not ask maintainers for production credentials, and never commit `.env.local` or any file containing real secrets. The repository `.gitignore` keeps `.env*` files ignored while explicitly allowing `.env.example` to remain tracked.

4. Keep mock mode enabled for normal contributor work:

```env
ENABLE_MOCK_PAYMENTS=true
ENABLE_MOCK_EMAILS=true
ENABLE_MOCK_STELLAR=true
```

With mock mode enabled, contributors can develop UI and most backend flows without maintainer Paystack, Resend, or Stellar signing credentials. Replace placeholders only with your own sandbox/test credentials when an issue explicitly requires live provider testing.

5. Start the development server:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Environment Notes

Use `.env.example` as the source of truth for safe local defaults. The categories below explain which values contributors normally need to edit.

| Variable | Status | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Required | Local app origin. Keep `http://localhost:3000` unless you run on another port. |
| `MONGODB_URI` | Required | Use a local MongoDB database or your own disposable development database. Do not use maintainer production data. |
| `JWT_SECRET` | Required | Set to any strong local development string. Do not reuse production secrets. |
| `AUTH_SESSION_SECRET` | Optional | Fallback session secret for local development. |
| `KYC_DOCUMENT_ENCRYPTION_KEY` | Optional | Local-only encryption fallback for KYC document references. Production uses maintainer-managed secrets. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Required for Privy auth | Public Privy app ID for the current auth flow. Use your own test app when exercising auth. |
| `PRIVY_APP_ID` | Optional | Server-side Privy app ID override; can match your test `NEXT_PUBLIC_PRIVY_APP_ID`. |
| `PRIVY_APP_SECRET` | Required for live Privy auth | Server-only Privy test secret. Leave as a placeholder unless you are testing live Privy flows. |
| `PRIVY_JWKS_URL` | Required for live Privy token verification | Use the JWKS URL for your own Privy test app. |
| `PAYSTACK_PUBLIC_KEY` | Optional | Public test key for live Paystack checkout experiments. |
| `PAYSTACK_SECRET_KEY` | Mock-only by default; required for live Paystack | Keep placeholder while `ENABLE_MOCK_PAYMENTS=true`; use only your own Paystack test secret for live payment testing. |
| `PAYSTACK_DVA_PREFERRED_BANK` | Optional | Bank slug for Paystack dedicated virtual account tests. The contributor template uses `test-bank`. |
| `RESEND_API_KEY` | Mock-only by default; required for live email | Keep placeholder while `ENABLE_MOCK_EMAILS=true`; use only your own Resend test key for live email testing. |
| `BLOB_READ_WRITE_TOKEN` | Optional | Needed only when exercising Vercel Blob-backed uploads outside managed environments. |
| `STELLAR_NETWORK` | Planned / mock-safe | Defaults to `testnet` for future Stellar integration work. |
| `STELLAR_HORIZON_URL` | Planned / mock-safe | Public Stellar Testnet Horizon URL. |
| `STELLAR_RPC_URL` | Planned / mock-safe | Public Stellar Testnet Soroban RPC URL. |
| `STELLAR_ASSET_CODE` | Planned / mock-safe | Development asset code placeholder, currently `CMOVE`. |
| `STELLAR_ISSUER_PUBLIC_KEY` | Planned / mock-only placeholder | Public key placeholder only; never commit secret keys or seed phrases. |
| `STELLAR_DISTRIBUTION_PUBLIC_KEY` | Planned / mock-only placeholder | Public key placeholder only; never commit secret keys or seed phrases. |
| `STELLAR_CONTRACT_ID` | Planned / mock-only placeholder | Fill only after deploying your own test contract. |
| `ENABLE_MOCK_PAYMENTS` | Mock mode | Keep `true` unless testing Paystack with your own sandbox keys. |
| `ENABLE_MOCK_EMAILS` | Mock mode | Keep `true` unless testing Resend with your own key. |
| `ENABLE_MOCK_STELLAR` | Mock mode | Keep `true` unless testing public Stellar Testnet reads or your own test deployment. |

Maintainer-only values such as production database URLs, production Paystack/Resend/Privy secrets, treasury private keys, Stellar signer secrets, wallet recovery material, and deployment credentials must never be committed or requested for contributor setup.

## Driver Dedicated Repayment Accounts

Drivers with an active hire-purchase contract can receive a Paystack dedicated virtual account in the repayment center.

- the account is provisioned automatically when the driver loads the repayment center and has the required profile fields
- bank transfers into that account are matched to the driver's active contract through the Paystack webhook
- overpayments still apply only up to the contract balance, with any excess credited to the driver's internal balance
- the existing Paystack checkout repayment flow remains available as a fallback if provisioning fails or the driver cannot use bank transfer
- investors can also receive a dedicated Paystack account for internal wallet funding, with webhook-based auto-crediting into `availableBalance`

### Driver Profile Requirements

The dedicated virtual account flows currently require:

- email
- name / full name
- phone number

If Paystack DVA eligibility for the business requires additional customer identification beyond those fields, the app surfaces the upstream error and leaves the fallback checkout flow available.

## Suggested Stellar Integration Path

- replace temporary EVM/Lisk Sepolia wallet configuration with Stellar account and wallet support
- add Stellar Testnet configuration for Horizon, Stellar RPC, Friendbot-funded development accounts, and explorer links
- define issuer and distribution account strategy for ChainMove vehicle pool assets
- publish asset metadata through a domain-hosted `/.well-known/stellar.toml` before public asset listings
- add Soroban contracts for vehicle pool ownership, payout rules, treasury actions, and governance execution
- index payment, repayment, payout, and contract events from Horizon or Stellar RPC into MongoDB
- map Paystack fiat funding and repayment events to Stellar settlement records where compliance and product rules allow
- promote production settlement flows to Stellar Mainnet when contracts, custody, compliance, and monitoring are ready

## Stellar References

- [Stellar Networks](https://developers.stellar.org/docs/networks)
- [Stellar Contract SDKs](https://developers.stellar.org/docs/tools/sdks/contract-sdks)
- [Publishing Stellar Asset Information](https://developers.stellar.org/docs/tokens/publishing-asset-info)
- [Anchor Integration](https://developers.stellar.org/docs/build/apps/example-application-tutorial/anchor-integration)

## Contribution Guide

When contributing, keep changes small and explicit, and document whether your work affects:

- application UX
- backend and payment behavior
- wallet flows
- Stellar integration assumptions

If you touch chain-related code or docs, keep naming consistent with the target stack:

- use `Stellar Testnet` for development references
- use `Stellar Mainnet` for production references
- use `Soroban` for Stellar smart contract references
- avoid reintroducing stale Arbitrum, Lisk, or Solana positioning into product or architecture docs

Before opening a PR, run:

```bash
npm run lint
```

## Roadmap

### Near-term

- finalize Stellar account and wallet integration strategy
- harden investor and driver onboarding flows
- improve pool investing and wallet funding UX
- add clearer payout and ownership reporting
- remove temporary non-Stellar chain dependencies once replacement code is ready

### Mid-term

- implement Stellar-backed pool assets and Soroban ownership contracts
- add automated payout and treasury accounting flows
- wire governance actions to onchain execution
- publish asset and organization metadata through `stellar.toml`
- improve analytics for investor transparency and driver repayment performance

## License

TBD. Recommended options: `MIT` or `Apache-2.0`.

## Contact

- Email: [okoyeemmanuelobiajulu@gmail.com](mailto:okoyeemmanuelobiajulu@gmail.com)
- X: [https://x.com/chainmove1](https://x.com/chainmove1)
- LinkedIn: [https://www.linkedin.com/company/chainmove/](https://www.linkedin.com/company/chainmove/)
