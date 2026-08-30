# Custody: Threshold Signing And Signer Rotation

This document covers the issuer/distribution/treasury custody control plane
implemented in `lib/custody/`. It follows the same conventions as
[configuration-and-key-rotation.md](./configuration-and-key-rotation.md) and
[tamper-evident-audit.md](./tamper-evident-audit.md): a local reference
implementation for contributor/testnet use, a documented adapter contract for
production, and every state change recorded in the tamper-evident audit log.

## Two layers

1. **Control plane** (`lib/custody/rotation.ts`, `models/CustodySignerSet.ts`):
   the platform's internal record of which signers, roles, and thresholds are
   authorized to approve each operation category, per network. Proposing,
   approving, activating, retiring, and rolling back a signer set never
   touches the Stellar ledger by itself.
2. **Envelopes** (`lib/custody/envelope.ts`, `lib/custody/service.ts`,
   `models/CustodyApprovalRequest.ts`): individual custody operations
   (issuance, payout, emergency, recovery, or executing a rotation on-chain)
   go through `requestApproval` → `approve` (repeated until quorum) →
   `finalizeAndSubmit`, which builds the real Stellar transaction, collects
   signatures through a `SignerAdapter`, and submits it.

Rotating the control-plane signer set for the `rotation` category and
actually changing a Stellar account's on-chain signers/thresholds (via
`Operation.setOptions`) are two different, sequenced actions: the
control-plane rotation authorizes who can approve the on-chain change; the
on-chain change itself is a normal envelope with
`intent.operation: "rotation.setSignerOptions"`.

## Roles and default thresholds

| Category  | Eligible roles                  | Min signers | Min threshold | Notes |
|-----------|----------------------------------|-------------|----------------|-------|
| issuance  | issuer                           | 3           | 2              | Mirrors issuer 2-of-3/3-of-5 cold multisig |
| payout    | distribution                     | 2           | 2              | Destination allowlist + amount/daily limits enforced |
| emergency | security, issuer                 | 2           | 1              | Fast freeze/revoke path |
| recovery  | recovery                         | 5           | 3              | Used when the standard quorum is unavailable |
| rotation  | issuer, distribution, security   | 3           | 2 (2 distinct roles) | Authorizes control-plane and on-chain rotation |

Defaults live in `lib/custody/policy.ts` as code, not secrets. The signers,
public keys, weights, and threshold actually in force for a deployment are
stored only in the DB-persisted `CustodySignerSet` document - never in env
vars or `lib/stellar/config.ts` (which is restricted to public identifiers).
`validateSignerSetInvariants()` rejects any proposed set where the threshold
exceeds total signer weight (a permanent lockout) or the category's minimum
signer/threshold/role-diversity requirements aren't met.

Quorum everywhere (envelope approvals, rotation approvals) is **weighted**,
not headcount-based: `sumApprovedWeight()` sums the `weight` of each
distinct approving signer and compares against `threshold`, matching
Stellar's own weighted-multisig semantics rather than a plain "N people"
count.

`payout` additionally requires a `payoutPolicy` on the active signer set
(`allowedDestinations`, optional `maxAmount`/`dailyLimit`, all in stroops).
`requestApproval` refuses any payout category request if the signer set has
no `payoutPolicy` configured, and enforces the allowlist/limits via
`assertPayoutWithinPolicy` before a request is ever created - a compromised
caller cannot supply its own allowlist, since it is read from the persisted
signer set, never from the request input.

## Signer adapter contract

No app process ever receives a raw signing secret. `SignerAdapter`
(`lib/custody/types.ts`) exposes only `getPublicKey(signerId)` and
`sign(signerId, payloadHash)`; both return public data (a public key or a
detached signature), never key material.

- `LocalDevSignerAdapter` (`lib/custody/signer-adapter.ts`) is a
  testnet-only reference implementation for contributor use and CI. It
  never reads or persists any secret - each `signerId` gets an ephemeral,
  process-local ed25519 keypair generated in memory. Its constructor reads
  the network from `getStellarConfig()` (not a caller-supplied value) and
  throws unless `STELLAR_NETWORK=testnet` and `ENABLE_MOCK_STELLAR=true`,
  so it is structurally incapable of running against mainnet.
- `createExternalSignerAdapter()` is a contract stub: it throws
  `CUSTODY_ADAPTER_NOT_CONFIGURED` until a deployment injects a real
  KMS/HSM/external-signer implementation. This repo does not mandate or
  implement a specific vendor.

## Rotation runbook

A rotation for *any* category (issuance, payout, emergency, recovery, or
rotation itself) is only ever approved by the **currently active `rotation`
(or, for the recovery path, `recovery`) category signer set** -
`approveRotation` looks up that governing set and rejects any `approvedBy`/
`role` that isn't a real, currently-authorized signer within it. This is
deliberate: it prevents a caller from fabricating approver identities to
satisfy quorum, and it means a category cannot approve its own replacement.

1. `proposeRotation({ category, network, signers, threshold, createdBy })` -
   validates invariants and creates a `pending` `CustodySignerSet` version.
2. `approveRotation({ signerSetId, approvedBy, role, quorumType: "standard" })`
   repeated by distinct, eligible governing-set signers until the governing
   set's threshold weight is met.
3. `activateRotation(signerSetId)` - the new set becomes `active`; the
   previous active set (if any) becomes `retiring` with an overlap window
   (`overlapWindowMs`, default 24h) during which **both** sets remain valid
   for collecting approvals on requests already pinned to the old version.
4. `retireIfSafe(signerSetId)` - the only path to `retired`. Refuses while
   the overlap window hasn't elapsed, or while any `CustodyApprovalRequest`
   still references the retiring version with a non-terminal status. Call
   this periodically (e.g. from a scheduled job) rather than on a timer that
   force-retires.
5. If a rotation must be undone, `rollbackRotation(signerSetId, { reason })`
   is reachable while the new set is `pending`, or after activation but
   before `retireIfSafe` has retired the previous set - it reactivates the
   previous set *before* marking the current one `rolled_back`, so a
   rollback can never leave the category with zero active signer sets; if
   the previous set has already fully retired, the rollback aborts instead
   and the active set is left unchanged.

### Bootstrap (genesis)

A brand new category/network has no governing signer set yet, so
`approveRotation` has nothing to check approvals against. `
seedGenesisSignerSet({ category, network, signers, threshold, createdBy,
confirmationToken: "CONFIRM_GENESIS_SIGNER_SET" })` creates the first
signer set directly as `active`, bypassing the approval flow - this is an
explicit, audited, out-of-band trust-anchor decision (same confirmation-token
idiom as `scripts/audit-migrate.ts`'s `cleanupOldAuditLogs`), meant to run
once per category/network from an operational script, never from an
automated or HTTP-reachable path.

### Recovery quorum (lost signer / compromise)

When a normal-quorum signer is lost or suspected compromised,
`approveRotation({ ..., quorumType: "recovery" })` routes approval through
the `recovery` category's signer pool and threshold instead of the
(possibly unavailable) standard rotation quorum. `activateRotation` detects
which quorum type was used from the first recorded approval and checks
against the matching threshold.

## Incident scenarios

**Signer compromise.** Immediately propose a rotation excluding the
compromised signer (standard quorum if enough uncompromised signers remain,
otherwise recovery quorum). Do not wait for the overlap window on the
compromised set - `retireIfSafe` will hold it in `retiring` until pending
requests clear, but a compromised signer can no longer collect new
approvals once the new set is `active` and is the one `requestApproval`
resolves for new requests.

**Lost signer.** If the lost signer is not suspected compromised, a standard
rotation is enough once the remaining signers still meet the category
threshold. If they don't, use the recovery quorum path.

**Stuck sequence.** If Horizon accepts a transaction but the response is
lost (timeout, crash between submit and write), `finalizeAndSubmit`'s
`submit` callback should throw `AmbiguousSubmissionError` rather than being
retried. The request is left in `submitting`. An operator must query
Horizon/an explorer for the transaction hash and call
`reconcileSubmission(requestId, { status: "submitted", ledgerResult })` or
`{ status: "failed", reason }` once the true outcome is known. Never build
and submit a second transaction for the same request while it is in
`submitting` - the atomic `quorum_reached -> submitting` claim in
`finalizeAndSubmit` prevents a second `finalizeAndSubmit` call from doing
so, but a manual resubmission outside this module could still double-spend
the sequence number. The default `submit` (when no `options.submit` is
injected) classifies any Horizon rejection that carries an HTTP response
(bad sequence, malformed transaction, insufficient signature weight, etc.)
as a definite failure, and anything without one (timeout, connection reset,
DNS failure) as `AmbiguousSubmissionError`, since Horizon may have applied
the transaction anyway.

**Partial signature / signer outage.** `approve()` accepts approvals one at
a time and only promotes a request to `quorum_reached` once enough distinct
eligible signers have responded; a request with fewer than the threshold
stays `pending` indefinitely (until `maxTime`, when `expireStaleRequests`
marks it `expired`) without blocking other requests or other signers. There
is no partial-signature submission: `finalizeAndSubmit` refuses to build a
transaction unless quorum is met.

**Outage.** If Horizon or the network is unavailable for longer than a
request's approval window, the request expires (`expireStaleRequests`) and
must be re-requested with a fresh envelope (new sequence, new time bounds)
once the network recovers - an expired envelope can never be resubmitted.

## Replay protection

- **Cross-network:** `assertEnvelopeFresh` rejects an envelope whose network
  or network passphrase doesn't match the currently configured network.
- **Stale/replayed sequence:** rejected against the per-source-account
  `CustodySequenceWatermark`, and the DB unique index on
  `(sourceAccount, network, sequence)` prevents two in-flight requests from
  ever targeting the same sequence.
- **Cross-intent:** `computeEnvelopeHash` includes the intent, so an
  envelope can never back two different requests. At `finalizeAndSubmit`,
  the operations are rebuilt from the stored intent and their hash is
  compared against the hash captured when the request was created
  (`operationsHash`); a mismatch aborts before any signature is collected.
- **Terminal states are immutable:** `submitted`/`failed`/`expired`
  approval requests and `retired`/`rolled_back` signer sets are enforced
  immutable at the Mongoose hook level, so a completed or abandoned
  envelope can never be edited back into a resubmittable state.

## Known limitations

- `rollbackRotation`: if reactivating the previous set succeeds but the
  subsequent flip of the current set to `rolled_back` then conflicts (a
  concurrent caller already changed it), both sets can briefly end up
  `active` for the same category/network. This never leaves zero active
  sets (the original bug), but resolving the duplicate today requires
  manual intervention rather than a safe retry.
- The payout daily-limit check in `requestApproval` (`sumPendingOrSubmittedPayoutStroopsToday`)
  is read-then-act, not atomic: two concurrent payout requests could each
  read a total under the limit and jointly exceed it. Multisig approval
  latency makes this a low-probability window; a hard guarantee would need
  an atomic counter.
- The default `submit` in `finalizeAndSubmit` can classify a timed-out
  pre-submission `checkMemoRequired` lookup (which runs before the
  transaction is ever posted) as `AmbiguousSubmissionError`, even though no
  submission was attempted. This only routes an occasional definite
  non-submission to manual reconciliation instead of auto-`failed`; it
  fails safe and cannot cause a double-submission.

## Audit trail

Every control-plane and envelope state change calls `logAuditEvent(...,
criticalAction: true)`, which writes to the append-only, hash-chained
tamper-evident audit log described in
[tamper-evident-audit.md](./tamper-evident-audit.md). This is what makes
every envelope traceable end to end: `custody.approval.requested` →
`custody.approval.granted` (one per signer) → `custody.envelope.submitted`
(or `.submission_failed` / `.submission_ambiguous`), plus
`custody.rotation.*` for control-plane changes.
