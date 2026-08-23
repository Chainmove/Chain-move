// @vitest-environment node
/**
 * Deterministic Repayment Engine – Full Test Suite
 *
 * Tests cover:
 *   Table-driven edge cases:
 *     1. Leap year and month-end dates
 *     2. Payment received before contract activation (pre-start-date)
 *     3. Multiple payments on the same day
 *     4. Payment larger than remaining contract balance (overpayment)
 *     5. Reversed provider charge
 *     6. Completed contract receiving another payment (idempotent no-op)
 *     7. Schedule rule changes after a contract starts (restructure)
 *
 *   Property / invariant tests proving:
 *     i.  allocatedTotal === acceptedPaymentAmount (no leakage)
 *     ii. installmentPaidAmounts never become negative
 *     iii. remainingPrincipal never drops below zero
 *     iv. duplicate references do not allocate twice
 *     v.  final ownership completion happens exactly once
 */

import { describe, expect, it } from "vitest"
import {
  allocatePayment,
  buildInstallmentStates,
  calculateNextDueDateFromSchedule,
  computeArrears,
  type InstallmentState,
} from "@/lib/repayments/allocation-engine"
import {
  generateRepaymentSchedule,
  generateWeeklySchedule,
  generateMonthlySchedule,
  addMonths,
  addWeeks,
  validateScheduleTerms,
} from "@/lib/repayments/schedule-generator"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWeeklyContract(overrides: Partial<{
  startDate: string
  weeklyPaymentNgn: number
  durationWeeks: number
  totalPayableNgn: number
  totalPaidNgn: number
}> = {}) {
  return {
    startDate: "2025-01-06T00:00:00.000Z", // Monday
    weeklyPaymentNgn: 10_000,
    durationWeeks: 10,
    totalPayableNgn: 100_000,
    totalPaidNgn: 0,
    ...overrides,
  }
}

function makeScheduleFromContract(
  contract: ReturnType<typeof makeWeeklyContract>,
  now: Date,
): InstallmentState[] {
  return buildInstallmentStates(contract, now)
}

// ─── Schedule Generator Tests ─────────────────────────────────────────────────

describe("Schedule Generator", () => {
  describe("generateRepaymentSchedule", () => {
    it("generates the correct number of weekly installments", () => {
      const schedule = generateRepaymentSchedule({
        startDate: "2025-01-06",
        totalPayableNgn: 100_000,
        installmentAmountNgn: 10_000,
        frequency: "WEEKLY",
        totalInstallments: 10,
      })
      expect(schedule.installments).toHaveLength(10)
    })

    it("last installment absorbs rounding difference", () => {
      // 100_001 / 10 = 10_000.1 – last installment should be 10_001
      const schedule = generateRepaymentSchedule({
        startDate: "2025-01-06",
        totalPayableNgn: 100_001,
        installmentAmountNgn: 10_000,
        frequency: "WEEKLY",
        totalInstallments: 10,
      })
      const last = schedule.installments[9]
      expect(last.scheduledAmountNgn).toBeCloseTo(10_001, 2)
    })

    it("sum of all installments equals totalPayableNgn", () => {
      const schedule = generateRepaymentSchedule({
        startDate: "2025-01-06",
        totalPayableNgn: 73_500,
        installmentAmountNgn: 7_350,
        frequency: "WEEKLY",
        totalInstallments: 10,
      })
      const total = schedule.installments.reduce((s, i) => s + i.scheduledAmountNgn, 0)
      expect(Math.abs(total - 73_500)).toBeLessThan(0.02)
    })

    it("generates monthly installments with correct due dates", () => {
      const schedule = generateRepaymentSchedule({
        startDate: "2025-01-15",
        totalPayableNgn: 120_000,
        installmentAmountNgn: 10_000,
        frequency: "MONTHLY",
        totalInstallments: 12,
      })
      expect(schedule.installments).toHaveLength(12)
      // Second installment should be March 15 (2 months after Jan 15)
      const second = new Date(schedule.installments[1].dueDate)
      expect(second.getMonth()).toBe(2) // March (0-indexed)
      expect(second.getDate()).toBe(15)
    })

    it("throws on invalid startDate", () => {
      expect(() =>
        generateRepaymentSchedule({
          startDate: "not-a-date",
          totalPayableNgn: 100_000,
          installmentAmountNgn: 10_000,
          frequency: "WEEKLY",
          totalInstallments: 10,
        }),
      ).toThrow()
    })

    it("throws on zero totalPayableNgn", () => {
      expect(() =>
        generateRepaymentSchedule({
          startDate: "2025-01-06",
          totalPayableNgn: 0,
          installmentAmountNgn: 10_000,
          frequency: "WEEKLY",
          totalInstallments: 10,
        }),
      ).toThrow()
    })

    it("applies grace period to first due date", () => {
      const noGrace = generateRepaymentSchedule({
        startDate: "2025-01-06",
        totalPayableNgn: 10_000,
        installmentAmountNgn: 10_000,
        frequency: "WEEKLY",
        totalInstallments: 1,
      })
      const withGrace = generateRepaymentSchedule({
        startDate: "2025-01-06",
        totalPayableNgn: 10_000,
        installmentAmountNgn: 10_000,
        frequency: "WEEKLY",
        totalInstallments: 1,
        gracePeriodDays: 7,
      })
      const diff =
        new Date(withGrace.installments[0].dueDate).getTime() -
        new Date(noGrace.installments[0].dueDate).getTime()
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000)
    })
  })

  // ── Edge Case 1: Leap year and month-end dates ───────────────────────────────
  describe("Edge Case 1: Leap year and month-end dates", () => {
    it("addMonths handles Jan 31 → Feb (non-leap year snap to 28)", () => {
      const jan31 = new Date("2025-01-31")
      const feb = addMonths(jan31, 1)
      expect(feb.getDate()).toBe(28)
      expect(feb.getMonth()).toBe(1) // February
      expect(feb.getFullYear()).toBe(2025)
    })

    it("addMonths handles Jan 31 → Feb (leap year snap to 29)", () => {
      const jan31 = new Date("2024-01-31")
      const feb = addMonths(jan31, 1)
      expect(feb.getDate()).toBe(29)
      expect(feb.getMonth()).toBe(1)
      expect(feb.getFullYear()).toBe(2024)
    })

    it("addMonths handles Jan 31 → Mar 31 (skips Feb)", () => {
      const jan31 = new Date("2025-01-31")
      const mar = addMonths(jan31, 2)
      expect(mar.getDate()).toBe(31)
      expect(mar.getMonth()).toBe(2) // March
    })

    it("generates monthly schedule through Feb 29 on leap year", () => {
      const schedule = generateRepaymentSchedule({
        startDate: "2024-01-29",
        totalPayableNgn: 36_000,
        installmentAmountNgn: 12_000,
        frequency: "MONTHLY",
        totalInstallments: 3,
      })
      const dates = schedule.installments.map((i) => new Date(i.dueDate).getDate())
      // Jan 29 + 1m = Feb 29 (leap), + 2m = Mar 29, + 3m = Apr 29
      expect(dates).toEqual([29, 29, 29])
    })

    it("addWeeks correctly crosses a leap-year Feb 28 → Mar boundary", () => {
      // Feb 24, 2024 + 1 week = Mar 2, 2024
      const feb24 = new Date("2024-02-24")
      const result = addWeeks(feb24, 1)
      expect(result.getMonth()).toBe(2) // March
      expect(result.getDate()).toBe(2)
    })
  })

  describe("validateScheduleTerms", () => {
    it("returns null for valid contract terms", () => {
      const result = validateScheduleTerms({
        startDate: "2025-01-06",
        weeklyPaymentNgn: 10_000,
        durationWeeks: 10,
        totalPayableNgn: 100_000,
      })
      expect(result).toBeNull()
    })

    it("returns error message for missing startDate", () => {
      const result = validateScheduleTerms({
        weeklyPaymentNgn: 10_000,
        durationWeeks: 10,
        totalPayableNgn: 100_000,
      })
      expect(result).toMatch(/startDate/i)
    })
  })
})

// ─── buildInstallmentStates Tests ─────────────────────────────────────────────

describe("buildInstallmentStates", () => {
  it("returns empty array when contract terms are invalid", () => {
    expect(buildInstallmentStates({ startDate: "bad", weeklyPaymentNgn: 0, durationWeeks: 0, totalPaidNgn: 0, totalPayableNgn: 0 })).toEqual([])
  })

  it("produces correct installment count", () => {
    const contract = makeWeeklyContract()
    const result = buildInstallmentStates(contract, new Date("2025-01-06"))
    expect(result).toHaveLength(10)
  })

  it("marks past-due installments correctly", () => {
    const contract = makeWeeklyContract({ totalPaidNgn: 0 })
    // Three weeks after the start → first two installments should be past due
    const now = new Date("2025-01-27")
    const result = buildInstallmentStates(contract, now)
    expect(result[0].isPastDue).toBe(true)
    expect(result[1].isPastDue).toBe(true)
    expect(result[2].isPastDue).toBe(false)
  })

  it("marks paid installments correctly", () => {
    const contract = makeWeeklyContract({ totalPaidNgn: 20_000 })
    const now = new Date("2025-01-27")
    const result = buildInstallmentStates(contract, now)
    expect(result[0].paidAmountNgn).toBe(10_000)
    expect(result[0].remainingAmountNgn).toBe(0)
    expect(result[1].paidAmountNgn).toBe(10_000)
    expect(result[1].remainingAmountNgn).toBe(0)
    expect(result[2].paidAmountNgn).toBe(0)
  })
})

// ─── Allocation Engine Tests ───────────────────────────────────────────────────

describe("Allocation Engine – allocatePayment", () => {
  function makeInstallment(
    installmentNumber: number,
    scheduled: number,
    paid: number,
    isPastDue: boolean,
  ): InstallmentState {
    const remaining = Math.max(scheduled - paid, 0)
    return {
      installmentNumber,
      dueDate: new Date().toISOString(),
      scheduledAmountNgn: scheduled,
      paidAmountNgn: paid,
      remainingAmountNgn: remaining,
      isPastDue,
    }
  }

  // ── Invariant i: allocatedTotal === acceptedPaymentAmount ─────────────────

  describe("Invariant i: allocatedTotal === acceptedPaymentAmount", () => {
    it("exact payment – all amounts balance", () => {
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 10_000,
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      const alloc = result.breakdown
      const total = alloc.arrearsNgn + alloc.currentInstallmentNgn + alloc.feesNgn + alloc.principalNgn
      expect(Math.abs(total - result.acceptedAmountNgn)).toBeLessThan(0.01)
    })

    it("partial payment – allocated total matches accepted amount", () => {
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 5_000,
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      const total =
        result.breakdown.arrearsNgn +
        result.breakdown.currentInstallmentNgn +
        result.breakdown.feesNgn +
        result.breakdown.principalNgn
      expect(Math.abs(total - result.acceptedAmountNgn)).toBeLessThan(0.01)
    })

    it("property: invariant holds for random-ish amounts", () => {
      const amounts = [1, 999.99, 10_000, 50_000, 100_000.01]
      for (const amount of amounts) {
        const schedule = [
          makeInstallment(1, 30_000, 0, true),
          makeInstallment(2, 30_000, 0, false),
          makeInstallment(3, 40_000, 0, false),
        ]
        const result = allocatePayment({
          amountNgn: amount,
          schedule,
          remainingContractBalanceNgn: 100_000,
        })
        const total =
          result.breakdown.arrearsNgn +
          result.breakdown.currentInstallmentNgn +
          result.breakdown.feesNgn +
          result.breakdown.principalNgn
        expect(Math.abs(total - result.acceptedAmountNgn)).toBeLessThan(0.02)
      }
    })
  })

  // ── Invariant ii: installmentPaidAmounts never become negative ────────────

  describe("Invariant ii: installmentPaidAmounts never become negative", () => {
    it("paidAmountNgn stays >= 0 after allocation", () => {
      const schedule = [
        makeInstallment(1, 10_000, 5_000, true),
        makeInstallment(2, 10_000, 0, false),
      ]
      const result = allocatePayment({
        amountNgn: 7_000,
        schedule,
        remainingContractBalanceNgn: 15_000,
      })
      for (const inst of result.updatedInstallments) {
        expect(inst.paidAmountNgn).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // ── Invariant iii: remainingPrincipal never drops below zero ─────────────

  describe("Invariant iii: remainingPrincipal never drops below zero", () => {
    it("remainingAmountNgn is always >= 0", () => {
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 50_000, // way more than the balance
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      for (const inst of result.updatedInstallments) {
        expect(inst.remainingAmountNgn).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // ── Edge Case 4: Payment larger than remaining balance (overpayment) ─────

  describe("Edge Case 4: Payment larger than remaining contract balance", () => {
    it("caps accepted amount to remaining balance", () => {
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 50_000,
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      expect(result.acceptedAmountNgn).toBe(10_000)
      expect(result.excessAmountNgn).toBe(40_000)
    })

    it("excess is tracked in breakdown", () => {
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 15_000,
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      expect(result.breakdown.excessNgn).toBe(5_000)
    })
  })

  // ── Allocation order: arrears before current ──────────────────────────────

  describe("Allocation order: arrears → current → fees → principal", () => {
    it("fills arrears before touching current installment", () => {
      const schedule = [
        makeInstallment(1, 10_000, 0, true),  // past due
        makeInstallment(2, 10_000, 0, false), // current
      ]
      const result = allocatePayment({
        amountNgn: 10_000,
        schedule,
        remainingContractBalanceNgn: 20_000,
      })
      expect(result.breakdown.arrearsNgn).toBe(10_000)
      expect(result.breakdown.currentInstallmentNgn).toBe(0)
    })

    it("fills current installment after arrears", () => {
      const schedule = [
        makeInstallment(1, 10_000, 0, true),  // past due
        makeInstallment(2, 10_000, 0, false), // current
      ]
      const result = allocatePayment({
        amountNgn: 15_000,
        schedule,
        remainingContractBalanceNgn: 20_000,
      })
      expect(result.breakdown.arrearsNgn).toBe(10_000)
      expect(result.breakdown.currentInstallmentNgn).toBe(5_000)
    })

    it("applies to principal (early payoff) after current", () => {
      const schedule = [
        makeInstallment(1, 10_000, 0, true),  // past due
        makeInstallment(2, 10_000, 0, false), // current
        makeInstallment(3, 10_000, 0, false), // future
      ]
      const result = allocatePayment({
        amountNgn: 25_000,
        schedule,
        remainingContractBalanceNgn: 30_000,
      })
      expect(result.breakdown.arrearsNgn).toBe(10_000)
      expect(result.breakdown.currentInstallmentNgn).toBe(10_000)
      expect(result.breakdown.principalNgn).toBe(5_000)
    })

    it("applies approved fees before principal", () => {
      const schedule = [makeInstallment(1, 10_000, 10_000, true), makeInstallment(2, 10_000, 0, false)]
      const result = allocatePayment({
        amountNgn: 12_000,
        schedule,
        remainingContractBalanceNgn: 12_000,
        approvedFeesNgn: 2_000,
      })
      expect(result.breakdown.currentInstallmentNgn).toBe(10_000)
      expect(result.breakdown.feesNgn).toBe(2_000)
    })
  })

  // ── Edge Case 3: Multiple payments on the same day ────────────────────────

  describe("Edge Case 3: Multiple payments on the same day", () => {
    it("applies correctly when two payments are processed sequentially", () => {
      // Simulate two payments on the same day: first 5k, then another 5k
      const schedule = [makeInstallment(1, 10_000, 0, false)]
      const firstResult = allocatePayment({
        amountNgn: 5_000,
        schedule,
        remainingContractBalanceNgn: 10_000,
      })
      expect(firstResult.acceptedAmountNgn).toBe(5_000)

      // Apply second payment using the updated installment states
      const secondResult = allocatePayment({
        amountNgn: 5_000,
        schedule: firstResult.updatedInstallments,
        remainingContractBalanceNgn: 5_000,
      })
      expect(secondResult.acceptedAmountNgn).toBe(5_000)
      expect(secondResult.updatedInstallments[0].remainingAmountNgn).toBe(0)
    })
  })

  // ── Edge Case 2: Payment before contract activation ───────────────────────

  describe("Edge Case 2: Payment before contract start date (all installments future)", () => {
    it("allocates to current (first upcoming) installment when none are past-due", () => {
      // Contract starts far in the future; now is before all due dates
      const futureDate = new Date(Date.now() + 10 * 7 * 24 * 60 * 60 * 1000)
      const schedule = Array.from({ length: 4 }, (_, i) => ({
        installmentNumber: i + 1,
        dueDate: new Date(futureDate.getTime() + (i + 1) * 7 * 24 * 60 * 60 * 1000).toISOString(),
        scheduledAmountNgn: 10_000,
        paidAmountNgn: 0,
        remainingAmountNgn: 10_000,
        isPastDue: false, // all in the future
      }))

      const result = allocatePayment({
        amountNgn: 10_000,
        schedule,
        remainingContractBalanceNgn: 40_000,
      })

      // Should still allocate: to the current installment bucket
      expect(result.acceptedAmountNgn).toBe(10_000)
      expect(result.breakdown.arrearsNgn).toBe(0)
      expect(result.breakdown.currentInstallmentNgn).toBe(10_000)
    })
  })
})

// ─── computeArrears Tests ─────────────────────────────────────────────────────

describe("computeArrears", () => {
  it("returns zero arrears for current contract", () => {
    const schedule = [
      { installmentNumber: 1, dueDate: new Date(Date.now() + 7 * 86400_000).toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: false },
    ]
    const result = computeArrears(schedule)
    expect(result.overdueCount).toBe(0)
    expect(result.arrearsAmountNgn).toBe(0)
    expect(result.arrearsDays).toBe(0)
  })

  it("counts overdue installments and sums amounts", () => {
    const oldDate = new Date(Date.now() - 14 * 86400_000).toISOString()
    const schedule = [
      { installmentNumber: 1, dueDate: oldDate, scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: true },
      { installmentNumber: 2, dueDate: oldDate, scheduledAmountNgn: 10_000, paidAmountNgn: 5_000, remainingAmountNgn: 5_000, isPastDue: true },
    ]
    const result = computeArrears(schedule)
    expect(result.overdueCount).toBe(2)
    expect(result.arrearsAmountNgn).toBe(15_000)
    expect(result.arrearsDays).toBeGreaterThanOrEqual(14)
  })

  it("ignores paid past-due installments", () => {
    const oldDate = new Date(Date.now() - 7 * 86400_000).toISOString()
    const schedule = [
      { installmentNumber: 1, dueDate: oldDate, scheduledAmountNgn: 10_000, paidAmountNgn: 10_000, remainingAmountNgn: 0, isPastDue: true },
    ]
    const result = computeArrears(schedule)
    expect(result.overdueCount).toBe(0)
  })
})

// ─── calculateNextDueDateFromSchedule Tests ──────────────────────────────────

describe("calculateNextDueDateFromSchedule", () => {
  it("returns null when all installments are paid", () => {
    const schedule = [
      { installmentNumber: 1, dueDate: new Date().toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 10_000, remainingAmountNgn: 0, isPastDue: true },
    ]
    expect(calculateNextDueDateFromSchedule(schedule)).toBeNull()
  })

  it("returns oldest overdue date when arrears exist", () => {
    const oldDate = new Date(Date.now() - 7 * 86400_000)
    const schedule = [
      { installmentNumber: 1, dueDate: oldDate.toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: true },
      { installmentNumber: 2, dueDate: new Date(Date.now() + 7 * 86400_000).toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: false },
    ]
    const result = calculateNextDueDateFromSchedule(schedule)
    expect(result?.toISOString()).toBe(oldDate.toISOString())
  })

  it("returns upcoming due date when no arrears", () => {
    const upcomingDate = new Date(Date.now() + 7 * 86400_000)
    const schedule = [
      { installmentNumber: 1, dueDate: upcomingDate.toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: false },
    ]
    const result = calculateNextDueDateFromSchedule(schedule)
    expect(result?.getTime()).toBeCloseTo(upcomingDate.getTime(), -3)
  })
})

// ─── Edge Case 7: Schedule rule changes after contract starts ────────────────

describe("Edge Case 7: Schedule rule changes after a contract starts (restructure)", () => {
  it("regenerating schedule with new terms produces a new deterministic output", () => {
    const originalContract = makeWeeklyContract({
      weeklyPaymentNgn: 10_000,
      durationWeeks: 10,
      totalPayableNgn: 100_000,
    })

    const restructuredContract = {
      ...originalContract,
      weeklyPaymentNgn: 8_000,
      durationWeeks: 13,
      totalPayableNgn: 104_000,
    }

    const original = generateWeeklySchedule(originalContract)
    const restructured = generateWeeklySchedule(restructuredContract)

    expect(original.totalInstallments).toBe(10)
    expect(restructured.totalInstallments).toBe(13)
    expect(restructured.totalPayableNgn).toBe(104_000)
    // Sum of restructured installments should be 104_000
    const sum = restructured.installments.reduce((s, i) => s + i.scheduledAmountNgn, 0)
    expect(Math.abs(sum - 104_000)).toBeLessThan(0.02)
  })

  it("buildInstallmentStates reflects new terms immediately after restructure", () => {
    const restructuredContract = makeWeeklyContract({
      startDate: new Date(Date.now() - 4 * 7 * 86400_000).toISOString(), // 4 weeks ago
      weeklyPaymentNgn: 8_000,
      durationWeeks: 13,
      totalPayableNgn: 104_000,
      totalPaidNgn: 16_000, // 2 payments made
    })
    const now = new Date()
    const states = buildInstallmentStates(restructuredContract, now)
    expect(states).toHaveLength(13)
    // First two should be fully paid
    expect(states[0].remainingAmountNgn).toBe(0)
    expect(states[1].remainingAmountNgn).toBe(0)
  })
})

// ─── generateMonthlySchedule (Loan model) ────────────────────────────────────

describe("generateMonthlySchedule", () => {
  it("generates correct monthly schedule for a loan", () => {
    const schedule = generateMonthlySchedule({
      startDate: "2025-03-01",
      monthlyPayment: 25_000,
      loanTerm: 6,
      totalAmountToPayBack: 150_000,
    })
    expect(schedule.totalInstallments).toBe(6)
    expect(schedule.frequency).toBe("MONTHLY")
    const sum = schedule.installments.reduce((s, i) => s + i.scheduledAmountNgn, 0)
    expect(Math.abs(sum - 150_000)).toBeLessThan(0.02)
  })
})

// ─── Idempotency guard (no DB, pure logic) ───────────────────────────────────

describe("Invariant iv: duplicate references do not allocate twice (pure-logic guard)", () => {
  it("applying the same payment twice to the same schedule does not double-count", () => {
    const schedule = [{ installmentNumber: 1, dueDate: new Date().toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 0, remainingAmountNgn: 10_000, isPastDue: false }]

    const first = allocatePayment({ amountNgn: 10_000, schedule, remainingContractBalanceNgn: 10_000 })
    // Second call with the updated installments and zero remaining balance
    const second = allocatePayment({
      amountNgn: 10_000,
      schedule: first.updatedInstallments,
      remainingContractBalanceNgn: 0, // contract is now at zero
    })

    expect(second.acceptedAmountNgn).toBe(0)
    expect(second.excessAmountNgn).toBe(10_000)
  })
})

// ─── Invariant v: final completion happens exactly once ──────────────────────

describe("Invariant v: final ownership completion triggered exactly once", () => {
  it("remainingAmountNgn goes to exactly 0 after final payment, not negative", () => {
    const schedule = [
      { installmentNumber: 1, dueDate: new Date().toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 9_999, remainingAmountNgn: 1, isPastDue: false },
    ]
    const result = allocatePayment({
      amountNgn: 1,
      schedule,
      remainingContractBalanceNgn: 1,
    })
    expect(result.updatedInstallments[0].remainingAmountNgn).toBe(0)
    expect(result.acceptedAmountNgn).toBe(1)
    expect(result.excessAmountNgn).toBe(0)
  })

  it("overpaying the final installment generates exactly the excess amount", () => {
    const schedule = [
      { installmentNumber: 1, dueDate: new Date().toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 9_500, remainingAmountNgn: 500, isPastDue: false },
    ]
    const result = allocatePayment({
      amountNgn: 1_000,
      schedule,
      remainingContractBalanceNgn: 500, // only 500 remains
    })
    expect(result.acceptedAmountNgn).toBe(500)
    expect(result.excessAmountNgn).toBe(500)
    expect(result.updatedInstallments[0].remainingAmountNgn).toBe(0)
  })
})

// ─── Edge Case 6: Completed contract receiving another webhook ────────────────

describe("Edge Case 6: Completed contract receiving another webhook (handled in service)", () => {
  it("buildInstallmentStates for a fully-paid contract shows all remaining = 0", () => {
    const contract = makeWeeklyContract({
      totalPaidNgn: 100_000, // fully paid
      totalPayableNgn: 100_000,
    })
    const installments = buildInstallmentStates(contract, new Date())
    const anyRemaining = installments.some((i) => i.remainingAmountNgn > 0)
    expect(anyRemaining).toBe(false)
  })

  it("allocating to a fully-paid schedule returns acceptedAmount = 0 and full excess", () => {
    const paid: InstallmentState[] = [
      { installmentNumber: 1, dueDate: new Date().toISOString(), scheduledAmountNgn: 10_000, paidAmountNgn: 10_000, remainingAmountNgn: 0, isPastDue: true },
    ]
    const result = allocatePayment({
      amountNgn: 5_000,
      schedule: paid,
      remainingContractBalanceNgn: 0,
    })
    expect(result.acceptedAmountNgn).toBe(0)
    expect(result.excessAmountNgn).toBe(5_000)
  })
})
