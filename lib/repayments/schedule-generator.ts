/**
 * Repayment Schedule Generator
 *
 * Generates immutable repayment schedules from contract terms. Supports:
 *   - Weekly and monthly schedules
 *   - Configurable start dates and grace periods
 *   - Final installment adjustment for rounding
 *   - Leap-year and month-end date handling
 *   - Schedule regeneration / check for legacy contracts
 */

export type ScheduleFrequency = "WEEKLY" | "MONTHLY"

export interface ScheduleGenerationInput {
  startDate: Date | string
  /** Total amount the driver must repay across all installments */
  totalPayableNgn: number
  /** Payment per period; the final installment is adjusted if there is rounding */
  installmentAmountNgn: number
  frequency: ScheduleFrequency
  /** Total number of installment periods */
  totalInstallments: number
  /** Number of days before the first payment is due (default 0) */
  gracePeriodDays?: number
}

export interface ScheduledInstallment {
  installmentNumber: number
  /** ISO date string – deterministic, never mutated after generation */
  dueDate: string
  scheduledAmountNgn: number
}

export interface RepaymentSchedule {
  frequency: ScheduleFrequency
  totalInstallments: number
  totalPayableNgn: number
  installments: ScheduledInstallment[]
  /** ISO date of the first due installment */
  firstDueDateIso: string
  /** ISO date of the last due installment */
  lastDueDateIso: string
}

/**
 * Add an exact number of calendar months to a date, preserving day-of-month
 * or snapping to month-end for months shorter than the source day.
 *
 * Examples:
 *   addMonths(Jan 31, 1) → Feb 28 / 29 (month-end snap)
 *   addMonths(Jan 31, 2) → Mar 31
 *   addMonths(Jan 29, 1) → Feb 28 / 29 (leap-year safe)
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const originalDay = date.getDate()
  result.setMonth(result.getMonth() + months, 1) // land safely on the 1st
  const maxDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate() // last day of target month
  result.setDate(Math.min(originalDay, maxDay))
  return result
}

/**
 * Add an exact number of weeks (7-day multiples) to a date.
 * Handles leap years automatically since we just add 7 days at a time.
 */
export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + weeks * 7)
  return result
}

/**
 * Advance a date by one installment period.
 */
function advancePeriod(date: Date, frequency: ScheduleFrequency, periods: number): Date {
  if (frequency === "MONTHLY") return addMonths(date, periods)
  return addWeeks(date, periods)
}

/**
 * Round to the nearest kobo (2 decimal places).
 */
function roundKobo(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Generate a fully deterministic repayment schedule from contract terms.
 *
 * The generated schedule is derived solely from immutable contract terms;
 * calling this function twice with the same input always yields the same result.
 *
 * @throws {RangeError} when inputs are invalid
 */
export function generateRepaymentSchedule(input: ScheduleGenerationInput): RepaymentSchedule {
  const {
    startDate: rawStartDate,
    totalPayableNgn,
    installmentAmountNgn,
    frequency,
    totalInstallments,
    gracePeriodDays = 0,
  } = input

  if (!rawStartDate) throw new RangeError("startDate is required")
  const baseDate = new Date(rawStartDate)
  if (Number.isNaN(baseDate.getTime())) throw new RangeError("startDate is not a valid date")
  if (!Number.isFinite(totalPayableNgn) || totalPayableNgn <= 0) throw new RangeError("totalPayableNgn must be > 0")
  if (!Number.isFinite(installmentAmountNgn) || installmentAmountNgn <= 0)
    throw new RangeError("installmentAmountNgn must be > 0")
  if (!Number.isFinite(totalInstallments) || totalInstallments < 1 || !Number.isInteger(totalInstallments))
    throw new RangeError("totalInstallments must be a positive integer")

  // Apply grace period offset to the base date for period calculations.
  const effectiveBase = new Date(baseDate)
  if (gracePeriodDays > 0) {
    effectiveBase.setDate(effectiveBase.getDate() + gracePeriodDays)
  }

  const installments: ScheduledInstallment[] = []

  for (let i = 0; i < totalInstallments; i++) {
    const installmentNumber = i + 1
    const dueDate = advancePeriod(effectiveBase, frequency, installmentNumber)

    // The last installment absorbs any rounding remainder so the total is exact.
    const isLast = i === totalInstallments - 1
    const scheduledSoFar = roundKobo(installmentAmountNgn * i)
    const scheduledAmountNgn = isLast
      ? roundKobo(Math.max(totalPayableNgn - scheduledSoFar, 0))
      : roundKobo(Math.min(installmentAmountNgn, roundKobo(totalPayableNgn - scheduledSoFar)))

    installments.push({
      installmentNumber,
      dueDate: dueDate.toISOString(),
      scheduledAmountNgn,
    })
  }

  return {
    frequency,
    totalInstallments,
    totalPayableNgn,
    installments,
    firstDueDateIso: installments[0].dueDate,
    lastDueDateIso: installments[installments.length - 1].dueDate,
  }
}

/**
 * Convenience helper: generate a weekly schedule from hire-purchase contract terms.
 * Matches the existing weekly-payment model on HirePurchaseContract.
 */
export function generateWeeklySchedule(contract: {
  startDate: Date | string
  weeklyPaymentNgn: number
  durationWeeks: number
  totalPayableNgn: number
  gracePeriodDays?: number
}): RepaymentSchedule {
  return generateRepaymentSchedule({
    startDate: contract.startDate,
    totalPayableNgn: contract.totalPayableNgn,
    installmentAmountNgn: contract.weeklyPaymentNgn,
    frequency: "WEEKLY",
    totalInstallments: contract.durationWeeks,
    gracePeriodDays: contract.gracePeriodDays,
  })
}

/**
 * Convenience helper: generate a monthly schedule from loan terms.
 * Matches the existing monthly-payment model on Loan.
 */
export function generateMonthlySchedule(loan: {
  startDate: Date | string
  monthlyPayment: number
  loanTerm: number // in months
  totalAmountToPayBack: number
  gracePeriodDays?: number
}): RepaymentSchedule {
  return generateRepaymentSchedule({
    startDate: loan.startDate,
    totalPayableNgn: loan.totalAmountToPayBack,
    installmentAmountNgn: loan.monthlyPayment,
    frequency: "MONTHLY",
    totalInstallments: loan.loanTerm,
    gracePeriodDays: loan.gracePeriodDays,
  })
}

/**
 * Validate that a contract's current stored terms can produce a valid schedule.
 * Returns null when the schedule is valid, or a human-readable error message.
 */
export function validateScheduleTerms(contract: {
  startDate?: Date | string | null
  weeklyPaymentNgn?: number
  durationWeeks?: number
  totalPayableNgn?: number
}): string | null {
  try {
    if (!contract.startDate) return "startDate is missing"
    if (!contract.weeklyPaymentNgn || contract.weeklyPaymentNgn <= 0) return "weeklyPaymentNgn must be > 0"
    if (!contract.durationWeeks || contract.durationWeeks < 1) return "durationWeeks must be >= 1"
    if (!contract.totalPayableNgn || contract.totalPayableNgn <= 0) return "totalPayableNgn must be > 0"

    const schedule = generateRepaymentSchedule({
      startDate: contract.startDate as Date | string,
      totalPayableNgn: contract.totalPayableNgn,
      installmentAmountNgn: contract.weeklyPaymentNgn,
      frequency: "WEEKLY",
      totalInstallments: contract.durationWeeks,
    })

    if (schedule.installments.length === 0) return "Schedule would have zero installments"

    return null
  } catch (err) {
    return err instanceof Error ? err.message : "Unknown schedule validation error"
  }
}
