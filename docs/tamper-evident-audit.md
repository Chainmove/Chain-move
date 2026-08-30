# Tamper-Evident Audit Logs

ChainMove records sensitive administrative and financial actions in an append-only hash chain. The default partition strategy is monthly (`YYYY-MM`) so verification and exports can be scoped without loading the full lifetime log. Each non-legacy event includes actor context, action, target, result, request ID, sanitized metadata, timestamp, sequence, previous hash, canonical data, and event hash.

## Critical Events

The compatibility writer in `lib/security/audit-log.ts` mirrors existing audit writes into the tamper-evident log. Actions containing `kyc`, `wallet`, `repayment`, `payout`, `loan`, `asset`, `investment`, `admin`, `user.role`, `notification.broadcast`, or `email.send` are treated as critical by default. Configure `CRITICAL_AUDIT_ACTIONS` as a comma-separated allowlist of critical action fragments when deployments need a stricter or narrower policy.

Critical audit failures throw `CRITICAL_AUDIT_FAILURE` and must block the business action. Failed business actions should be logged with `status: "failure"` whenever the attempt is security-relevant.

## Privacy Rules

Audit metadata is sanitized before hashing. Do not include passwords, tokens, private keys, session IDs, raw KYC documents, raw gateway payloads, unnecessary PII, or full bank/card data. Use stable identifiers, object IDs, short reason codes, amounts, currencies, status transitions, and redacted summaries instead.

Filtered exports may use `--redact-pii`. Redacted exports include `sourceEventHash` for traceability and recompute an export-local hash chain so offline verification proves the exported content has not changed.

## Checkpoints

`createCheckpoint(partition)` signs the ordered event-hash root for events not yet checkpointed. Contributor mode uses the local HMAC signer configured by `AUDIT_CHECKPOINT_PRIVATE_KEY`; production should replace the signer adapter with KMS, HSM, or external transparency storage.

Set `AUDIT_CHECKPOINT_PREVIOUS_KEYS` to a comma-separated list of retired HMAC keys during rotation. Verification accepts the active key plus previous keys. Keep retired keys until every checkpoint signed by them is outside retention and backup restore windows.

Recommended rotation:

1. Add the current key to `AUDIT_CHECKPOINT_PREVIOUS_KEYS`.
2. Deploy a new `AUDIT_CHECKPOINT_PRIVATE_KEY`.
3. Create a checkpoint and verify it with `npm run audit:verify -- --partition=YYYY-MM --checkpoints`.
4. Retire old keys only after retention and legal-hold windows expire.

## Migration

Run `npm run audit:migrate` once per environment to copy existing mutable audit logs into a `legacy-YYYY-MM` partition. Legacy events are clearly marked with `isLegacy: true`; they remain accessible but do not fabricate pre-migration proof. Do not delete the old collection unless legal, retention, and backup requirements explicitly permit it.

## Export And Verification

Export a partition:

```bash
npm run audit:export -- --partition=2026-07 --output=audit-export.json --checkpoints
```

Verify the live database:

```bash
npm run audit:verify -- --partition=2026-07 --checkpoints
```

Verify an export offline from the project checkout:

```bash
npm install
npm run audit:verify -- --file=audit-export.json
```

Verification reports the first broken chain link, sequence gaps, malformed events, hash mismatches, and checkpoint signature/root failures.

## Retention And Access

Retain tamper-evident audit logs and checkpoints for at least seven years for financial and KYC evidence unless a stricter legal hold applies. Limit read access to security, compliance, and authorized administrators. Direct database update/delete permissions for audit collections must not be granted to application operators; emergency database access must be ticketed and followed by full partition verification.

## Incident Procedure

If verification fails, stop automated deletion or archival for the affected partition, preserve database and export snapshots, record the first failing sequence and checkpoint, compare against externalized checkpoint roots where available, and open a security incident. Rebuild trust from the last valid checkpoint; do not repair audit history in place.
