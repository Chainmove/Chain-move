# Deletion limitations

Not everything can be removed from ChainMove's records automatically.
This document explains what stays, why, and what the user is told at the
time of their request.

## 1. Financial records (retained 7 years)

Regulatory obligations require ChainMove to keep monetary history
(transaction ledger, hire-purchase contracts, loan repayments, payouts,
tax-relevant metadata). When a user is deleted:

- Personal fields (`userId`, `driverId`, `investorId`, etc.) are
  replaced with deterministic pseudonyms so related records stay
  joinable for audit.
- Monetary fields (`amount`, `currency`, `paystackRef`, etc.) are kept
  verbatim — they are needed to reconstruct financial history.
- The deletion request records `retentionPolicyVersion` on the
  `PrivacyRequest` so the policy in force at the time is provable.

The user is told about this in the export bundle's `notice` field and
in the deletion API response.

## 2. Audit records (retained 7 years)

The tamper-evident audit log cannot be edited — that would break the
hash chain. When a user is deleted:

- `actorId` and `metadata` fields are pseudonymized.
- The record remains in the log so that the chain of custody for past
  actions stays valid.
- The action sequence is preserved; only the *identity* is removed.

## 3. Provider references (not deletable)

External providers own their customer / account records. ChainMove can
remove its local row but cannot touch the provider's record.

| Provider   | Field                | Local action on deletion                  |
| ---------- | -------------------- | ---------------------------------------- |
| Paystack   | `paystackCustomerCode` | preserved (provider-owned)             |
| Paystack   | `paystackCustomerId`   | preserved (provider-owned)             |
| Paystack   | `dedicatedAccountId`   | preserved (provider-owned)             |
| Privy      | `privyUserId`          | cleared on User record                 |
| Stellar    | `stellarPublicKey`     | kept on chain (immutable)              |

The local row is pseudonymized so the user's personal fields are
removed even though the provider references survive. The export bundle
includes the provider references as opaque identifiers.

## 4. KYC documents (5-year minimum)

Encrypted KYC blobs are kept for at least 5 years for regulatory
reasons. After the retention window and once no legal hold applies,
they are hard-deleted (the encrypted blob is removed from object
storage and the metadata is removed from the database). The user's
export references the document metadata (so they can re-download from
storage if they have the right) but never includes the blob itself.

## 5. Wallet addresses (blockchain immutability)

Stellar / EVM wallet addresses are public on the blockchain. Removing
them from ChainMove's database does not remove them from the chain.
We can:

- Clear the address from the User document.
- Pseudonymize the address on associated records (loans, investments,
  repayments).

We **cannot** remove the address from the public ledger.

## 6. Active holds block deletion

A legal or operational hold on a user or any of their resources will
refuse deletion. The hold is surfaced in the API response so the user
sees exactly which record is blocking their request. Holds expire on
their `expiresAt` (or when an admin releases them).

## 7. In-flight requests

A deletion cannot be cancelled once `PROCESSING` has started. The
pipeline is committed at that point — partial completion is fine
(because the pipeline is resumable), but rolling back is not.

## 8. Repeated requests

Calling `POST /api/privacy/deletion/request` twice with the same
`Idempotency-Key` returns the same request record. Calling twice
without an idempotency key creates a second request — the second one
will be rejected at confirmation time if a deletion is already in
COOLING_OFF for the same user.
