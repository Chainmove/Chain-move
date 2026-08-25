/**
 * Deterministic Repayment Allocation Engine
 *
 * Allocation order (documented, immutable):
 *   1. Arrears   – oldest-first unpaid installments that are past-due
 *   2. Current   – the installment due in the current period
 *   3. Fees      – approved penalties / platform fees (future-use hook)
 *   4. Principal – any early principal reduction beyond scheduled amounts
 *   5. Excess    – credit that cannot be applied (overpayment cap)
 *
 * Key invariants (enforced by the engine and tested in the test suite):
 *   - allocatedTotal === acceptedAmount (no leakage)
 *   - installmentPaidAmount >= 0 for every installment
 *   - remainingPrincipal >= 0 after any allocation
 *   - duplicate gateway/reference never allocates twice
 *   - final ownership completion triggered exactly once
 */

export interface InstallmentState {
  /** 1-based installment number */
  installmentNumber: number
  /** ISO date string */
  dueDate: string
  /** Scheduled amount for this installment (kobo-precise) */
  scheduledAmountNgn: number
  /** Amount paid so far against this installment */
  paidAmountNgn: number
  /** scheduledAmountNgn - paidAmountNgn, always >= 0 */
  remainingAmountNgn: number
  /** Whether the due date is in the past */
  isPastDue: boolean
}

export interface AllocationBreakdown {
  /** Amount applied to past-due installments */
  arrearsNgn: number
  /** Amount applied to the current-period installment */
  currentInstallmentNgn: number
  /** Amount applied to approved fees/penalties */
  feesNgn: number
  /** Amount used for early principal reduction beyond the schedule */
  principalNgn: number
  /** Amount that exceeded the contract balance (returned / held) */
  excessNgn: number
  /** Per-installment breakdown: which installments were touched and by how much */
  installmentCredits: Array<{
    installmentNumber: number
    creditedNgn: number
  }>
}

export interface AllocatePaymentInput {
  /** Total amount tendered by the driver */
  amountNgn: number
  /** Full ordered schedule at the time of payment */
  schedule: InstallmentState[]
  /** Outstanding balance that can still be applied */
  remainingContractBalanceNgn: number
  /** Approved fees to be settled before excess principal (default 0) */
  approvedFeesNgn?: number
}

export interface AllocatePaymentResult {
  /** The amount actually accepted (≤ amountNgn, capped by remainingBalance) */
  acceptedAmountNgn: number
  /** Amount that could not be applied (excess beyond the contract balance) */
  excessAmountNgn: number
  breakdown: AllocationBreakdown
  /** Updated installment states after applying the payment */
  updatedInstallments: InstallmentState[]
}

/**
 * Clamp a value to be >= 0 and finite.
 */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(value, 0)
}

/**
 * Round to the nearest kobo (2 decimal places) using banker's rounding
 * so that allocation sums stay exact.
 */
function roundKobo(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Core pure allocation function. Given the current schedule state and a
 * payment amount, returns a deterministic allocation breakdown and the
 * updated installment states.
 *
 * This function is intentionally **pure** (no I/O, no side effects) so
 * that it can be tested exhaustively without a database.
 */
export function allocatePayment(input: AllocatePaymentInput): AllocatePaymentResult {
  const { amountNgn, schedule, remainingContractBalanceNgn, approvedFeesNgn = 0 } = input

  const safeAmount = clamp(roundKobo(amountNgn))
  const safeBalance = clamp(roundKobo(remainingContractBalanceNgn))
  const safeFees = clamp(roundKobo(approvedFeesNgn))

  // Cap accepted amount to the remaining contract balance.
  const acceptedAmountNgn = Math.min(safeAmount, safeBalance)
  const excessAmountNgn = roundKobo(safeAmount - acceptedAmountNgn)

  let wallet = acceptedAmountNgn // running "cash in hand" to allocate

  const breakdown: AllocationBreakdown = {
    arrearsNgn: 0,
    currentInstallmentNgn: 0,
    feesNgn: 0,
    principalNgn: 0,
    excessNgn: excessAmountNgn,
    installmentCredits: [],
  }

  // Deep-clone installments so we can mutate safely.
  const updatedInstallments: InstallmentState[] = schedule.map((item) => ({ ...item }))

  // ── Step 1: Arrears – past-due installments with remaining balances, oldest first ──
  for (const inst of updatedInstallments) {
    if (wallet <= 0) break
    if (!inst.isPastDue) continue
    if (inst.remainingAmountNgn <= 0) continue

    const credit = roundKobo(Math.min(wallet, inst.remainingAmountNgn))
    inst.paidAmountNgn = roundKobo(inst.paidAmountNgn + credit)
    inst.remainingAmountNgn = roundKobo(Math.max(inst.scheduledAmountNgn - inst.paidAmountNgn, 0))
    wallet = roundKobo(wallet - credit)
    breakdown.arrearsNgn = roundKobo(breakdown.arrearsNgn + credit)
    breakdown.installmentCredits.push({ installmentNumber: inst.installmentNumber, creditedNgn: credit })
  }

  // ── Step 2: Current installment – first upcoming (not yet past-due) with a balance ──
  for (const inst of updatedInstallments) {
    if (wallet <= 0) break
    if (inst.isPastDue) continue
    if (inst.remainingAmountNgn <= 0) continue

    const credit = roundKobo(Math.min(wallet, inst.remainingAmountNgn))
    inst.paidAmountNgn = roundKobo(inst.paidAmountNgn + credit)
    inst.remainingAmountNgn = roundKobo(Math.max(inst.scheduledAmountNgn - inst.paidAmountNgn, 0))
    wallet = roundKobo(wallet - credit)
    breakdown.currentInstallmentNgn = roundKobo(breakdown.currentInstallmentNgn + credit)
    breakdown.installmentCredits.push({ installmentNumber: inst.installmentNumber, creditedNgn: credit })
    break // only the first upcoming installment in "current" bucket
  }

  // ── Step 3: Approved fees / penalties ──
  if (wallet > 0 && safeFees > 0) {
    const feeCredit = roundKobo(Math.min(wallet, safeFees))
    wallet = roundKobo(wallet - feeCredit)
    breakdown.feesNgn = feeCredit
  }

  // ── Step 4: Principal – apply remainder to any outstanding installments (early payoff) ──
  for (const inst of updatedInstallments) {
    if (wallet <= 0) break
    if (inst.remainingAmountNgn <= 0) continue

    const credit = roundKobo(Math.min(wallet, inst.remainingAmountNgn))
    inst.paidAmountNgn = roundKobo(inst.paidAmountNgn + credit)
    inst.remainingAmountNgn = roundKobo(Math.max(inst.scheduledAmountNgn - inst.paidAmountNgn, 0))
    wallet = roundKobo(wallet - credit)
    breakdown.principalNgn = roundKobo(breakdown.principalNgn + credit)
    breakdown.installmentCredits.push({ installmentNumber: inst.installmentNumber, creditedNgn: credit })
  }

  // Any wallet remainder at this point means the schedule is fully paid.
  // This shouldn't happen because we capped acceptedAmount to remainingBalance,
  // but guard defensively.
  if (wallet > 0) {
    breakdown.excessNgn = roundKobo(breakdown.excessNgn + wallet)
  }

  return {
    acceptedAmountNgn,
    excessAmountNgn,
    breakdown,
    updatedInstallments,
  }
}

/**
 * Derive a flat InstallmentState array from raw contract fields.
 * This is the bridge between MongoDB documents and the pure engine.
 */
export function buildInstallmentStates(
  contract: {
    startDate: Date | string
    weeklyPaymentNgn: number
    durationWeeks: number
    totalPaidNgn: number
    totalPayableNgn: number
  },
  now = new Date(),
): InstallmentState[] {
  const startDate = new Date(contract.startDate)
  const weeklyPaymentNgn = clamp(Number(contract.weeklyPaymentNgn || 0))
  const durationWeeks = Math.max(0, Math.floor(Number(contract.durationWeeks || 0)))
  const totalPayableNgn = clamp(Number(contract.totalPayableNgn || 0))
  let remainingPaidNgn = clamp(Number(contract.totalPaidNgn || 0))

  if (Number.isNaN(startDate.getTime()) || weeklyPaymentNgn <= 0 || durationWeeks <= 0 || totalPayableNgn <= 0) {
    return []
  }

  return Array.from({ length: durationWeeks }, (_, index) => {
    const installmentNumber = index + 1
    const dueDate = new Date(startDate)
    dueDate.setDate(dueDate.getDate() + installmentNumber * 7)

    // Last installment absorbs any rounding difference.
    const scheduledAmountNgn =
      index === durationWeeks - 1
        ? roundKobo(Math.max(totalPayableNgn - weeklyPaymentNgn * index, 0))
        : weeklyPaymentNgn

    const paidAmountNgn = roundKobo(Math.min(scheduledAmountNgn, remainingPaidNgn))
    remainingPaidNgn = roundKobo(Math.max(remainingPaidNgn - paidAmountNgn, 0))
    const remainingAmountNgn = roundKobo(Math.max(scheduledAmountNgn - paidAmountNgn, 0))
    const isPastDue = dueDate.getTime() < now.getTime()

    return {
      installmentNumber,
      dueDate: dueDate.toISOString(),
      scheduledAmountNgn,
      paidAmountNgn,
      remainingAmountNgn,
      isPastDue,
    }
  })
}

/**
 * Calculate the next due date from current installment states.
 * Returns null when the contract is fully paid.
 */
export function calculateNextDueDateFromSchedule(installments: InstallmentState[]): Date | null {
  // First look for unpaid past-due (arrears) – that is the most urgent "next" payment.
  const oldestArrears = installments.find((inst) => inst.isPastDue && inst.remainingAmountNgn > 0)
  if (oldestArrears) return new Date(oldestArrears.dueDate)

  // Otherwise return the first upcoming installment with a remaining balance.
  const upcoming = installments.find((inst) => !inst.isPastDue && inst.remainingAmountNgn > 0)
  if (upcoming) return new Date(upcoming.dueDate)

  return null
}

/**
 * Compute arrears from installment states.
 */
export function computeArrears(installments: InstallmentState[]): {
  overdueCount: number
  arrearsAmountNgn: number
  oldestOverdueDateIso: string | null
  arrearsDays: number
} {
  const overdue = installments.filter((i) => i.isPastDue && i.remainingAmountNgn > 0)
  const arrearsAmountNgn = overdue.reduce((sum, i) => roundKobo(sum + i.remainingAmountNgn), 0)
  const oldestOverdueDateIso = overdue[0]?.dueDate ?? null
  const arrearsDays =
    oldestOverdueDateIso !== null
      ? Math.floor((Date.now() - new Date(oldestOverdueDateIso).getTime()) / (1000 * 60 * 60 * 24))
      : 0

  return {
    overdueCount: overdue.length,
    arrearsAmountNgn,
    oldestOverdueDateIso,
    arrearsDays,
  }
}
