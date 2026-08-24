# Retention matrix

This matrix is the operational view of the privacy data map. It tells you
how long each category is kept, what triggers automatic deletion, and
which categories survive a user-initiated deletion.

| Category            | Retention window | Auto-delete trigger                                | Survives user deletion? |
| ------------------- | ---------------- | -------------------------------------------------- | ----------------------- |
| `contact_pii`       | until anonymized | deletion request (after cooling-off)               | anonymized              |
| `auth_pii`          | until hard-delete| deletion request                                   | cleared                 |
| `wallet_pii`        | until anonymized | deletion request                                   | anonymized              |
| `provider_reference`| until pseudonymized | deletion request                                | pseudonymized (provider-owned fields preserved) |
| `kyc_document`      | 7 years          | `retentionExpiresAt` reached, no active hold       | hard delete             |
| `financial_record`  | 7 years          | never (regulatory window)                          | pseudonymized (amounts preserved) |
| `audit_record`      | 7 years          | never                                              | retained + pseudonymized |
| `preference`        | until deletion   | deletion request                                   | hard delete             |
| `derived_metrics`   | until deletion   | deletion request                                   | pseudonymized           |

## Policy versions

Each pipeline execution records the policy version
(`RETENTION_POLICY_VERSION` in `lib/privacy/data-map.ts`) on the
`PrivacyRequest`. Bump the version when the retention matrix changes
materially so audit records can prove which policy applied at the time of
execution.

## Configurable knobs

| Env var                          | Effect                                          | Default |
| -------------------------------- | ----------------------------------------------- | ------- |
| `PRIVACY_COOLING_OFF_HOURS`      | Cooling-off period between confirmation and deletion | `24`  |
| `PRIVACY_CONFIRMATION_TTL_MINUTES` | Confirmation token lifetime                  | `60`    |
| `PRIVACY_EXPORT_ARCHIVE_TTL_HOURS` | Time a download link stays valid              | `168` (7 days) |
| `PRIVACY_PSEUDONYM_SALT`         | Salt for deterministic pseudonyms               | required |

## Automatic retention sweep

The privacy sweep (`lib/privacy/privacy-sweep.ts`) does three things on a
cron schedule:

1. Advance deletion requests whose cooling-off period has elapsed.
2. Mark expired archives as `EXPIRED` and wipe their file from disk.
3. Mark expired legal holds as `EXPIRED`.

Run it with `npm run privacy:sweep`. It is idempotent — safe to invoke
more often than necessary.
