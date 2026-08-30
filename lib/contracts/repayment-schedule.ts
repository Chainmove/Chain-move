// Pure repayment-schedule derivation, shared by the driver-contracts service
// (read-side snapshots) and the contract-transition service (activation
// preconditions), without either service importing from the other.

export type RepaymentScheduleStatus = "PAID" | "PARTIAL" | "LATE" | "UPCOMING"

export interface DriverRepaymentScheduleItem {
  installmentNumber: number
  dueDate: string
  expectedAmountNgn: number
  paidAmountNgn: number
  remainingAmountNgn: number
  status: RepaymentScheduleStatus
}

export function clampToNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(value, 0)
}

export function buildRepaymentSchedule(
  contract: {
    startDate: Date | string
    weeklyPaymentNgn: number
    durationWeeks: number
    totalPaidNgn: number
    totalPayableNgn: number
  },
  now = new Date(),
): DriverRepaymentScheduleItem[] {
  const startDate = new Date(contract.startDate)
  const weeklyPaymentNgn = clampToNonNegative(Number(contract.weeklyPaymentNgn || 0))
  const durationWeeks = Math.max(0, Math.floor(Number(contract.durationWeeks || 0)))
  const totalPayableNgn = clampToNonNegative(Number(contract.totalPayableNgn || 0))
  let remainingPaidNgn = clampToNonNegative(Number(contract.totalPaidNgn || 0))

  if (Number.isNaN(startDate.getTime()) || weeklyPaymentNgn <= 0 || durationWeeks <= 0 || totalPayableNgn <= 0) {
    return []
  }

  return Array.from({ length: durationWeeks }, (_, index) => {
    const installmentNumber = index + 1
    const dueDate = new Date(startDate)
    dueDate.setDate(dueDate.getDate() + installmentNumber * 7)
    const scheduledCap = index === durationWeeks - 1 ? totalPayableNgn - weeklyPaymentNgn * index : weeklyPaymentNgn
    const expectedAmountNgn = clampToNonNegative(Math.min(weeklyPaymentNgn, scheduledCap))
    const paidAmountNgn = Math.min(expectedAmountNgn, remainingPaidNgn)
    remainingPaidNgn = clampToNonNegative(remainingPaidNgn - paidAmountNgn)
    const remainingAmountNgn = clampToNonNegative(expectedAmountNgn - paidAmountNgn)
    const isPastDue = dueDate.getTime() < now.getTime()
    const status: RepaymentScheduleStatus = remainingAmountNgn <= 0
      ? "PAID"
      : isPastDue && paidAmountNgn > 0
        ? "PARTIAL"
        : isPastDue
          ? "LATE"
          : "UPCOMING"

    return {
      installmentNumber,
      dueDate: dueDate.toISOString(),
      expectedAmountNgn,
      paidAmountNgn,
      remainingAmountNgn,
      status,
    }
  })
}
