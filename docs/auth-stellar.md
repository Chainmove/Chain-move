# Privy Authentication and Stellar Account Linking

This document explains how Privy authentication and Stellar account linking work together in ChainMove.

## Architecture overview

ChainMove uses two separate, complementary identity layers:

| Layer | Purpose | Handled by |
|---|---|---|
| **Authentication** | Who you are / session identity | Privy |
| **Stellar identity** | On-chain account reference | `stellarPublicKey` stored in MongoDB |

Privy remains the only authentication mechanism. Stellar account data is an optional addition to a user profile — it does not replace or bypass Privy.

## Privy authentication flow

1. The user signs in via Privy (email, phone, embedded wallet, or social OAuth).
2. The client receives a Privy identity token (JWT).
3. The client sends the token to `POST /api/auth/privy/sync`.
4. The server verifies the token against Privy's JWKS endpoint and extracts a `ParsedPrivyProfile`.
5. The server upserts a ChainMove `User` record, matching on `privyUserId`, `email`, or `walletAddress`.
6. A signed HTTP-only session cookie is issued.

No Privy credentials or tokens are stored in the database. Only the `privyUserId` (Privy's internal ID) is saved so future sessions can locate the same user.

## User model — Stellar fields

Four optional Stellar fields are added to `models/User.ts`:

```ts
stellarPublicKey    // StrKey-encoded ed25519 public key (starts with "G", 56 chars)
stellarAccountType  // "external_wallet" | "platform_managed" | "unknown"
stellarLinkedAt     // Date the Stellar key was first linked
stellarLastSyncedAt // Date of the last Stellar network sync
```

All four fields are optional. Existing users without a Stellar account work without any migration. The `stellarPublicKey` field has a sparse unique index, so multiple users can have `null` while no two users can share the same public key.

**What is never stored:** secret keys, seed phrases, or any signing material. Only the public key is saved.

## Stellar account linking flow

Once a user is authenticated via Privy:

1. The user navigates to their profile settings and opens the Stellar account section.
2. They enter their Stellar public key (StrKey, starts with `G`, 56 characters).
3. The client validates the format before submitting.
4. The client sends `POST /api/auth/stellar/link` with the key in the request body.
5. The server:
   - Authenticates the request via session cookie or Privy token.
   - Validates the full StrKey format including the CRC16-XModem checksum (`lib/validation/stellar.ts`).
   - Checks that no other user already owns this key (returns `409` if taken).
   - Saves `stellarPublicKey` and sets `stellarLinkedAt` (first link only).
6. The response includes a safe profile snapshot — never raw Mongoose document fields.

### Key security properties

- The endpoint requires an authenticated session. Unauthenticated requests receive `401`.
- The StrKey checksum validation is done server-side independently of any external library, preventing malformed keys from reaching the database.
- A sparse unique index at the database level prevents duplicate keys even under concurrent requests.
- A `409` is returned both when the pre-save check detects a duplicate and when the unique index rejects a concurrent save (`code: 11000`).
- `stellarLinkedAt` is only set on the first link and is never overwritten by re-links, preserving the original linkage timestamp.

## Environment variables

No Stellar-specific environment variables are required to use the linking flow. The linking route stores only user-supplied public keys.

Future Stellar network features (balance reads, payment indexing) will require:

```
STELLAR_NETWORK          # "testnet" or "mainnet" (default: "testnet")
STELLAR_HORIZON_URL      # Horizon REST endpoint
STELLAR_RPC_URL          # Soroban RPC endpoint
STELLAR_ASSET_CODE       # e.g. "CMOVE"
STELLAR_ISSUER_PUBLIC_KEY
STELLAR_DISTRIBUTION_PUBLIC_KEY
STELLAR_CONTRACT_ID
```

See `lib/stellar/config.ts` for defaults and mock mode.

## Files involved

| File | Role |
|---|---|
| `models/User.ts` | Adds optional Stellar fields to the user schema |
| `lib/validation/stellar.ts` | StrKey format + CRC16 checksum validation |
| `app/api/auth/stellar/link/route.ts` | `POST /api/auth/stellar/link` — links a key to an authenticated user |
| `app/api/auth/privy/sync/route.ts` | Privy token sync and user upsert |
| `lib/auth/privy.ts` | Privy JWT verification and profile extraction |
| `lib/auth/current-user.ts` | Session resolution for authenticated routes |
| `lib/users/user-profile.ts` | Safe profile snapshot type (`UserProfileSnapshot`) |
| `components/dashboard/stellar-link-form.tsx` | Investor/driver UI for entering and submitting a public key |
| `components/dashboard/account-settings-form.tsx` | Settings page wrapper that embeds `StellarLinkForm` |

## Adding a Stellar account as a contributor

To test locally without real Stellar credentials:

1. Sign in via Privy (use the Privy sandbox app ID from `.env.example`).
2. Navigate to `/dashboard/investor/settings` or `/dashboard/driver/settings`.
3. Enter any valid Stellar testnet public key (StrKey format).
4. The key is validated and stored — no network call to Stellar is made during linking.

Valid testnet public keys can be generated at [https://laboratory.stellar.org](https://laboratory.stellar.org) using **Generate Keypair** (use only the public key — never paste the secret key into ChainMove).
