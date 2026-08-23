# Repayment Engine

> **Issue #87** – Deterministic repayment schedule, allocation, and arrears engine

---

## Overview

The repayment engine is the single authoritative source of truth for everything
related to hire-purchase repayments:

- Generates **immutable repayment schedules** from contract terms
- **Allocates every driver payment** across arrears, current installment, fees,
  principal, and excess in a documented, deterministic order
- Recalculates **next due date**, **outstanding balance**, and **arrears metrics**
  after every payment
- Keeps payment application **idempotent** by gateway/reference ID
- Supports **reversal/correction** without deleting payment history
- Provides a **schedule check / repair command** for legacy contracts

---

## Module layout

```
lib/repayments/
├── index.ts                    # Barrel export (public API)
├── allocation-engine.ts        # Pure allocation logic + installment state helpers
├── schedule-generator.ts       # Schedule generation (weekly & monthly)
└── repayment-engine.service.ts # Orchestration: DB persistence, idempotency, reversals

models/
├── PaymentAllocation.ts        # Per-payment transparent breakdown record
└── PaymentReversal.ts          # Compensating record for reversed payments

__tests__/lib/repayments/
└── repayment-engine.test.ts    # Full test suite (table-driven + invariants)

scripts/
└── check-repayment-schedules.ts  # Legacy contract check / repair CLI
```

---

## Allocation order

Every confirmed driver payment is allocated in this **documented, immutable** order:

| Priority | Bucket               | Description                                              |
|----------|----------------------|----------------------------------------------------------|
| 1        | **Arrears**          | Past-due installments, oldest first                      |
| 2        | **Current**          | The installment due in the current period                |
| 3        | **Fees**             | Approved penalties / platform fees (future-use hook)     |
| 4        | **Principal**        | Early principal reduction beyond scheduled amounts       |
| 5        | **Excess**           | Credit that cannot be applied (capped, returned to wallet)|

---

## Invariants

The following invariants are enforced by the engine **and** tested in the test suite:

1. `allocatedTotal === acceptedPaymentAmount` – no leakage
2. `installmentPaidAmount >= 0` for every installment
3. `remainingPrincipal >= 0` after any allocation
4. Duplicate gateway references do not allocate twice
5. Final ownership completion is triggered exactly once

---

## Edge cases handled

| # | Edge case                                           | Handling                                                |
|---|-----------------------------------------------------|---------------------------------------------------------|
| i | Leap year and month-end dates                       | `addMonths` snaps to last day of shorter months         |
| ii| Payment before contract activation                  | Rejects with `Contract is not in a repayable state`     |
| iii| Multiple payments on the same day                  | Each gets its own `PaymentAllocation` record            |
| iv| Payment larger than remaining balance               | Accepted amount capped; excess credited to driver wallet|
| v | Reversed provider charge                            | `reverseDriverPayment` creates compensating record      |
| vi| Completed contract receiving another webhook        | Returns `alreadyProcessed: true`, no double application |
| vii| Schedule rule changes after contract starts (restructure) | `buildInstallmentStates` uses current contract terms  |

---

## Quick-start for contributors

### Apply a payment

```typescript
import { applyDriverPayment } from "@/lib/repayments"

const result = await applyDriverPayment("ps_ref_abc123", {
  verifiedAmountNgn: 10_000,
  channel: "card",
})
// result.allocation contains the full breakdown
```

### Reverse a payment

```typescript
import { reverseDriverPayment } from "@/lib/repayments"

const result = await reverseDriverPayment({
  originalGatewayRef: "ps_ref_abc123",
  reason: "PROVIDER_CHARGEBACK",
  notes: "Paystack reversed the charge on 2025-03-01",
  initiatedByUserId: adminUser._id.toString(),
})
```

### Generate a schedule

```typescript
import { generateWeeklySchedule } from "@/lib/repayments"

const schedule = generateWeeklySchedule({
  startDate: "2025-01-06",
  weeklyPaymentNgn: 10_000,
  durationWeeks: 52,
  totalPayableNgn: 520_000,
})
```

### Check arrears

```typescript
import { getArrearsReport } from "@/lib/repayments"

const arrears = await getArrearsReport(contractId)
// { overdueCount, arrearsAmountNgn, oldestOverdueDateIso, arrearsDays }
```

---

## CLI commands

```bash
# Check all active contracts for schedule inconsistencies (dry-run)
npm run repayment:check-schedules

# Check a single contract
npm run repayment:check-schedules -- --contract-id <id>

# Repair totalPaidNgn mismatches (writes to MongoDB)
npm run repayment:repair-schedules

# Repair a single contract
npm run repayment:repair-schedules -- --contract-id <id>
```

---

## Running the tests

```bash
# Run only the repayment engine tests
npx vitest run __tests__/lib/repayments

# Run the full suite
npm test
```

---

## Key design decisions

### Pure core, thin orchestration layer

`allocation-engine.ts` and `schedule-generator.ts` are **pure functions** with no
I/O. All database writes are handled in `repayment-engine.service.ts`. This
makes the core trivially testable and reusable in read-only contexts (dashboards,
schedule previews, etc.).

### Idempotency via `PaymentAllocation` unique index

A `PaymentAllocation` document is created with a unique index on `gatewayRef`.
Any attempt to re-process the same gateway reference short-circuits immediately
and returns the existing allocation — regardless of how many times the webhook
fires.

### Reversals never delete history

`reverseDriverPayment` creates a `PaymentReversal` document and adjusts the
contract balance. The original `DriverPayment` is never deleted or modified
beyond its initial `CONFIRMED` state. This makes the payment ledger fully
auditable.

### Month-end safety

`addMonths` in `schedule-generator.ts` always clamps the day of month to the
last valid day of the target month. This correctly handles Jan 31 → Feb 28/29
and similar cases across all locales.
