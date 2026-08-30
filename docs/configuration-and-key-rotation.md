# Configuration And Key Rotation

Typed configuration lives in `lib/config/schema.ts`. Server-only callers use `lib/config/server.ts`; browser-safe callers use `lib/config/public.ts`.

Production rejects weak placeholders and mock payment, email, or Stellar modes. Diagnostics are redacted:

```bash
npm run config:diagnostics
```

KYC document encryption uses a versioned keyring. The active key encrypts new documents; active and previous keys can decrypt existing documents.

Rotation runbook:

1. Add a new active key to `KYC_ENCRYPTION_KEYS_JSON` and move the old active key to `previous`.
2. Run a dry deployment and `npm run config:diagnostics` to confirm only key versions and fingerprints are printed.
3. Re-encrypt/backfill stored encrypted KYC payloads in batches, recording progress outside the encrypted data.
4. Verify decrypt success using active and previous versions.
5. Retire previous keys only after all payloads and backups using them are past retention.

Rollback/forward fix: keep the previous key configured until verification passes. If a deploy is interrupted, resume with the same keyring; do not remove the previous version until all affected payloads are confirmed re-encrypted.
