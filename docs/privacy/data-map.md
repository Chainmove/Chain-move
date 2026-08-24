# Privacy data map

This document describes the personal data ChainMove stores, where it lives,
and what category of personal information each field represents. The data
map is the authoritative input for both the data export pipeline
(`lib/privacy/data-export.service.ts`) and the deletion pipeline
(`lib/privacy/privacy-deletion.service.ts`).

The map is maintained in code (`lib/privacy/data-map.ts`) so it can be
unit-tested and linted. When you add a new collection, you **must** add a
matching entry here — no personal data may be left out.

## Categories

| Category              | Examples                                  | Retention reason                | Exportable       | Default deletion strategy |
| --------------------- | ----------------------------------------- | ------------------------------- | ---------------- | ------------------------- |
| `essential_identity`  | account role, account creation date       | required for system operation   | summary only     | retained                  |
| `contact_pii`         | name, email, phone, address, bio          | required for product experience | yes              | anonymize                 |
| `auth_pii`            | password hash, session identifiers        | required for security           | no               | hard delete               |
| `wallet_pii`          | linked wallet addresses                   | optional — depends on chain     | yes              | anonymize                 |
| `provider_reference`  | Paystack / Privy / Stellar identifiers    | provider owns the record        | reference only   | pseudonymize              |
| `kyc_document`        | encrypted blob + metadata                 | 5 years (regulatory minimum)    | reference only   | hard delete after window  |
| `financial_record`    | transactions, loans, contracts, returns  | 7 years (regulatory window)     | pseudonymized    | pseudonymize              |
| `audit_record`        | tamper-evident audit events               | 7 years (regulatory window)     | pseudonymized    | retain + pseudonymize     |
| `preference`          | notification preferences                  | none                            | yes              | hard delete               |
| `derived_metrics`     | aggregate balances, totals                | recomputed from financial rows  | pseudonymized    | pseudonymize              |

## Models covered

```
User                     Notification
KycDocument              NotificationPreference
Vehicle                  Loan
PoolInvestment           HirePurchaseContract
DriverPayment            DriverVirtualAccount
InvestorVirtualAccount   InvestorCredit
Transaction              Investment
Issue                    WalletRecovery
AuditLog
```

## Adding a new collection

1. Add the new model under `models/`.
2. Append a `PrivacyDataMapEntry` row in `lib/privacy/data-map.ts`.
3. Add a unit test in `__tests__/lib/privacy/data-map.test.ts` if the new
   model has any non-obvious retention rules.
4. If the model has provider references that cannot be auto-deleted, list
   them in the `providerReferences` array — the deletion-limitations
   document and the export bundle both surface them to the user.
5. Re-run `npm run test` and `npm run typecheck`.
