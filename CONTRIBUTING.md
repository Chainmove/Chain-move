# Contributing to ChainMove

Thanks for helping improve ChainMove. ChainMove is an open-source mobility finance platform for fractional vehicle ownership, pay-to-own driver financing, investor pool management, repayments, dashboards, and future Stellar integration.

## Contributor safety rules

- Do not ask maintainers for production credentials, database URLs, payment provider secrets, deployment credentials, or signing material.
- Do not commit `.env.local`, real secrets, screenshots showing secrets, logs containing bearer tokens, or wallet recovery material.
- Use `.env.example` as your starting point and replace placeholders only with your own local, sandbox, or test values.
- Use mock mode for contribution work unless your issue specifically requires a sandbox integration test.
- Production deployments and production credentials are maintainer-only.

## Local setup

```bash
git clone https://github.com/Obiajulu-gif/chain_move.git
cd chain_move
npm install
cp .env.example .env.local
npm run dev
```

Then update `.env.local` with local placeholders or your own test credentials. Keep the mock flags enabled unless your issue specifically requires a live sandbox provider. The template is safe to commit; `.env.local` is not.

### Environment categories

- **Required for local app state:** `NEXT_PUBLIC_APP_URL`, `MONGODB_URI`, and `JWT_SECRET`.
- **Required for live Privy auth testing:** `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `PRIVY_JWKS_URL`; `PRIVY_APP_ID` is an optional server-side override.
- **Optional local/server features:** `AUTH_SESSION_SECRET`, `KYC_DOCUMENT_ENCRYPTION_KEY`, `PAYSTACK_DVA_PREFERRED_BANK`, `PAYSTACK_PUBLIC_KEY`, and `BLOB_READ_WRITE_TOKEN`.
- **Mock-only by default:** `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `STELLAR_ISSUER_PUBLIC_KEY`, `STELLAR_DISTRIBUTION_PUBLIC_KEY`, and `STELLAR_CONTRACT_ID` can remain placeholders while mock mode is enabled.
- **Planned Stellar testnet defaults:** `STELLAR_NETWORK`, `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, and `STELLAR_ASSET_CODE` document the intended testnet configuration and do not require maintainer credentials.

## Mock mode

Contributor development should normally run with:

```env
ENABLE_MOCK_PAYMENTS=true
ENABLE_MOCK_EMAILS=true
ENABLE_MOCK_STELLAR=true
```

Recommended behavior for contributors implementing mock support:

- Paystack checkout: return a fake successful initialization response with a local authorization URL and generated reference.
- Paystack dedicated virtual accounts: return a deterministic mock bank account for driver/investor repayment testing.
- Resend email: log a safe mock email result without calling Resend.
- Stellar: return deterministic testnet-shaped account, asset, payment, and contract responses without requiring sensitive credentials.

## Environment variables

Only variables prefixed with `NEXT_PUBLIC_` may be used in client-side files. Server-only values such as `MONGODB_URI`, `JWT_SECRET`, `PRIVY_APP_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, and `BLOB_READ_WRITE_TOKEN` must stay in server routes, server actions, or backend services.

## Before opening a PR

Run:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## PR scope

Keep pull requests small and clear. In your PR description, state whether your change affects:

- Frontend / UI
- Backend / API routes
- Auth / Privy
- Payments / Paystack
- Email / Resend
- Stellar / Soroban
- MongoDB models
- Documentation
- Tests
- Security

## Working on GrantFox issues

When picking an issue:

1. Comment on the issue and wait for maintainer assignment if required.
2. Create a branch from `main`.
3. Keep the change focused on the issue acceptance criteria.
4. Add screenshots for UI changes.
5. Add test notes and commands run.

## Stellar contribution guidance

Stellar is the target blockchain layer for ChainMove. New chain work should prefer:

- Stellar Testnet for development
- Horizon for account and payment history
- Stellar RPC for Soroban contract interactions
- public account identifiers only in database records and frontend views
- no sensitive signing material in frontend code
- no production credentials in contributor PRs

Avoid reintroducing stale Lisk, EVM, Solana, or Thirdweb assumptions unless the issue is specifically about removing or isolating legacy code.

## Security-sensitive changes

Open a small PR and explain the risk being fixed. Security-sensitive areas include session handling, Privy token verification, Paystack webhooks, KYC upload/encryption, Stellar signing, admin permissions, and database access controls.

## Environment Setup

1. Copy the example environment file:

```bash
cp .env.example .env.local
```
Populate only your local development values.
Never request production credentials from maintainers.
Never commit:
.env.local
API keys
JWT secrets
database credentials
Stellar private keys

---

## Mock Development

Contributors should use mock mode whenever possible.

Do not depend on production services for feature development.

Use local test data and development configurations.

---

## Pull Request Guidelines

Keep pull requests focused.

Good examples:

- Wallet UI improvements
- Documentation updates
- Authentication fixes
- Stellar integration enhancements

Avoid combining unrelated changes.

Before opening a PR run:

```bash
npm run lint
npm run build
```

---

## Affected Areas

When opening a PR specify:

- Frontend
- Backend
- Authentication
- Payments
- Stellar
- Documentation
- Tests
- UI/UX

