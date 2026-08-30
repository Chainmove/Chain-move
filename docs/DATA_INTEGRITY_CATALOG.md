# Data Integrity Subsystem & Invariant Catalog

This document describes the cross-model invariant scanning and safe repair subsystem for ChainMove.

## Core Concepts

### Severity Taxonomy
- **CRITICAL**: Invariants affecting financial ledger accuracy, active contract exclusivity, or balance calculations. Immediate attention required.
- **HIGH**: Broken entity references, status contradictions, or funding metric mismatches that impact business operations.
- **MEDIUM**: Deprecated schema patterns, legacy fields, or non-critical formatting discrepancies.
- **LOW**: Informational or minor metadata drift.

### Repairability Levels
- **AUTOMATIC**: Deterministic, non-ambiguous updates (e.g. syncing vehicle status, updating legacy fields).
- **STRATEGY_REQUIRED**: Financial adjustments requiring audited ledger entries or explicit strategy calculation (e.g., wallet balance reconciliation, pool funding re-aggregation).
- **MANUAL_ONLY**: Ambiguous or multi-owner structural errors (e.g. orphaned financial records, multiple active contracts) where automatic guessing is prohibited.

---

## Invariant Rules Catalog

| Rule ID | Name | Severity | Category | Affected Models | Repairability |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `INV_ORPHANED_USER_REF` | Orphaned User Reference | HIGH | REFERENTIAL | Loan, Vehicle, HirePurchaseContract | MANUAL_ONLY / AUTOMATIC |
| `INV_ORPHANED_VEHICLE_REF` | Orphaned Vehicle Reference | HIGH | REFERENTIAL | Loan, Investment | MANUAL_ONLY |
| `INV_ORPHANED_POOL_REF` | Orphaned Pool Reference | HIGH | REFERENTIAL | HirePurchaseContract, PoolInvestment | MANUAL_ONLY |
| `INV_MULTIPLE_ACTIVE_CONTRACTS` | Multiple Active Contracts | CRITICAL | STATUS_CONTRADICTION | HirePurchaseContract | MANUAL_ONLY |
| `INV_VEHICLE_STATUS_CONTRADICTION` | Vehicle Status Contradiction | HIGH | STATUS_CONTRADICTION | Vehicle, Loan | AUTOMATIC |
| `INV_LOAN_STATUS_CONTRADICTION` | Loan Status Contradiction | HIGH | STATUS_CONTRADICTION | Loan | AUTOMATIC |
| `INV_LOAN_FUNDING_TOTAL_MISMATCH` | Loan Funding Total Mismatch | HIGH | FINANCIAL_MISMATCH | Loan, Investment | STRATEGY_REQUIRED |
| `INV_POOL_FUNDING_TOTAL_MISMATCH` | Pool Funding Total Mismatch | HIGH | FINANCIAL_MISMATCH | InvestmentPool, PoolInvestment | STRATEGY_REQUIRED |
| `INV_WALLET_BALANCE_MISMATCH` | User Wallet Balance Mismatch | CRITICAL | FINANCIAL_MISMATCH | User, Transaction | STRATEGY_REQUIRED |
| `INV_DUPLICATE_GATEWAY_REF` | Duplicate Gateway Reference | HIGH | DUPLICATE_IDENTIFIER | Transaction, VirtualAccount | MANUAL_ONLY |
| `INV_COMPLETED_CONTRACT_BALANCE_REMAINING` | Completed Contract Balance Remaining | HIGH | STATUS_CONTRADICTION | HirePurchaseContract | AUTOMATIC |
| `INV_LEGACY_FIELDS_MISMATCH` | Legacy Fields Inconsistency | MEDIUM | SCHEMA_DEPRECATION | User | AUTOMATIC |

---

## Safety & Financial Integrity Rules

1. **Read-Only Scanner**: Scans are 100% read-only and generate persistent findings without mutating business data.
2. **Financial Repairs**: Balance reconciliation (`INV_WALLET_BALANCE_MISMATCH`) creates audited `Transaction` ledger records (`wallet_funding` / `wallet_debit`) with metadata linking back to the finding fingerprint.
3. **PII Redaction**: All report summaries, CSV exports, and finding diagnostic logs automatically redact emails, phone numbers, addresses, and secrets.
4. **Deduplication**: Re-running scans uses SHA-256 fingerprints to update existing findings (`lastSeenAt`, `scanCount`) without duplicating database entries.

---

## Operations & CLI Usage

### CLI Execution
```bash
# Run full invariant scan with JSON output
npx tsx scripts/data-integrity.ts --scan

# Export CSV report
npx tsx scripts/data-integrity.ts --scan --format=csv

# Preview repair (dry-run)
npx tsx scripts/data-integrity.ts --repair --finding=FINDING_ID --dry-run

# Apply repair with transaction
npx tsx scripts/data-integrity.ts --repair --finding=FINDING_ID --apply
```

### Admin API Endpoints
- `GET /api/admin/data-integrity/scan?format=json|csv`: Fetch scan summary or CSV export.
- `POST /api/admin/data-integrity/scan`: Trigger scanner.
- `POST /api/admin/data-integrity/repair`: Request repair preview (`action: "preview"`) or apply (`action: "apply"`).
- `POST /api/admin/data-integrity/findings/:id/suppress`: Mark false positives as suppressed with notes.
