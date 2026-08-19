// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  isValidLoanTransition,
  isLoanActorAllowed,
  isTerminalLoanState,
  isRepayableLoanState,
  LOAN_VALID_TRANSITIONS,
  TERMINAL_LOAN_STATES,
  PRE_ACTIVE_LOAN_STATES,
  type LoanStatus,
} from "@/lib/domain/loan-state-machine"

const ALL_STATES: LoanStatus[] = [
  "Pending",
  "Under Review",
  "Approved",
  "Rejected",
  "Active",
  "Completed",
  "Cancelled",
]

describe("Loan state machine", () => {
  describe("isValidLoanTransition", () => {
    it("allows any state from null (initial creation)", () => {
      for (const state of ALL_STATES) {
        expect(isValidLoanTransition(null, state)).toBe(true)
      }
    })

    it("allows same-state no-op transitions", () => {
      for (const state of ALL_STATES) {
        expect(isValidLoanTransition(state, state)).toBe(true)
      }
    })

    it("walks the happy path lifecycle", () => {
      expect(isValidLoanTransition("Pending", "Under Review")).toBe(true)
      expect(isValidLoanTransition("Under Review", "Approved")).toBe(true)
      expect(isValidLoanTransition("Approved", "Active")).toBe(true)
      expect(isValidLoanTransition("Active", "Completed")).toBe(true)
    })

    it("allows rejection from any pre-active state", () => {
      expect(isValidLoanTransition("Pending", "Rejected")).toBe(true)
      expect(isValidLoanTransition("Under Review", "Rejected")).toBe(true)
      expect(isValidLoanTransition("Approved", "Rejected")).toBe(true)
    })

    it("allows cancellation from any pre-active state", () => {
      expect(isValidLoanTransition("Pending", "Cancelled")).toBe(true)
      expect(isValidLoanTransition("Under Review", "Cancelled")).toBe(true)
      expect(isValidLoanTransition("Approved", "Cancelled")).toBe(true)
    })

    it("rejects skipping Under Review", () => {
      expect(isValidLoanTransition("Pending", "Approved")).toBe(false)
      expect(isValidLoanTransition("Pending", "Active")).toBe(false)
    })

    it("rejects skipping Approved", () => {
      expect(isValidLoanTransition("Under Review", "Active")).toBe(false)
    })

    it("rejects any transition out of terminal states", () => {
      for (const terminal of TERMINAL_LOAN_STATES) {
        for (const state of ALL_STATES) {
          if (state === terminal) continue
          expect(isValidLoanTransition(terminal, state)).toBe(false)
        }
      }
    })

    it("rejects cancelling an active loan", () => {
      expect(isValidLoanTransition("Active", "Cancelled")).toBe(false)
    })

    it("rejects re-activating a completed loan", () => {
      expect(isValidLoanTransition("Completed", "Active")).toBe(false)
    })

    it("every listed transition target is a known status", () => {
      for (const [from, targets] of Object.entries(LOAN_VALID_TRANSITIONS)) {
        expect(ALL_STATES).toContain(from as LoanStatus)
        for (const target of targets) {
          expect(ALL_STATES).toContain(target)
        }
      }
    })
  })

  describe("isLoanActorAllowed", () => {
    it("only admin can start review", () => {
      expect(isLoanActorAllowed("Under Review", "Pending", "admin")).toBe(true)
      expect(isLoanActorAllowed("Under Review", "Pending", "driver")).toBe(false)
      expect(isLoanActorAllowed("Under Review", "Pending", "system")).toBe(false)
    })

    it("only admin can approve", () => {
      expect(isLoanActorAllowed("Approved", "Under Review", "admin")).toBe(true)
      expect(isLoanActorAllowed("Approved", "Under Review", "driver")).toBe(false)
      expect(isLoanActorAllowed("Approved", "Under Review", "system")).toBe(false)
    })

    it("only admin can reject", () => {
      expect(isLoanActorAllowed("Rejected", "Pending", "admin")).toBe(true)
      expect(isLoanActorAllowed("Rejected", "Pending", "driver")).toBe(false)
      expect(isLoanActorAllowed("Rejected", "Pending", "system")).toBe(false)
    })

    it("admin and system can activate", () => {
      expect(isLoanActorAllowed("Active", "Approved", "admin")).toBe(true)
      expect(isLoanActorAllowed("Active", "Approved", "system")).toBe(true)
      expect(isLoanActorAllowed("Active", "Approved", "driver")).toBe(false)
    })

    it("admin and system can complete", () => {
      expect(isLoanActorAllowed("Completed", "Active", "admin")).toBe(true)
      expect(isLoanActorAllowed("Completed", "Active", "system")).toBe(true)
      expect(isLoanActorAllowed("Completed", "Active", "driver")).toBe(false)
    })

    it("driver can cancel from any pre-active state", () => {
      for (const state of PRE_ACTIVE_LOAN_STATES) {
        expect(isLoanActorAllowed("Cancelled", state, "driver")).toBe(true)
      }
    })

    it("driver cannot cancel from Active (not a pre-active state)", () => {
      // Active is not in PRE_ACTIVE_LOAN_STATES, but the transition itself is also invalid
      expect(isLoanActorAllowed("Cancelled", "Active", "driver")).toBe(false)
    })

    it("admin can cancel from any pre-active state", () => {
      for (const state of PRE_ACTIVE_LOAN_STATES) {
        expect(isLoanActorAllowed("Cancelled", state, "admin")).toBe(true)
      }
    })

    it("driver cannot cancel from null (initial)", () => {
      expect(isLoanActorAllowed("Cancelled", null, "driver")).toBe(false)
    })
  })

  describe("isTerminalLoanState", () => {
    it("marks Rejected, Completed, and Cancelled as terminal", () => {
      expect(isTerminalLoanState("Rejected")).toBe(true)
      expect(isTerminalLoanState("Completed")).toBe(true)
      expect(isTerminalLoanState("Cancelled")).toBe(true)
    })

    it("does not mark non-terminal states as terminal", () => {
      expect(isTerminalLoanState("Pending")).toBe(false)
      expect(isTerminalLoanState("Under Review")).toBe(false)
      expect(isTerminalLoanState("Approved")).toBe(false)
      expect(isTerminalLoanState("Active")).toBe(false)
    })
  })

  describe("isRepayableLoanState", () => {
    it("only Active is repayable", () => {
      expect(isRepayableLoanState("Active")).toBe(true)
    })

    it("no other states are repayable", () => {
      const nonRepayable: Array<LoanStatus | null | undefined> = [
        "Pending",
        "Under Review",
        "Approved",
        "Rejected",
        "Completed",
        "Cancelled",
        null,
        undefined,
      ]
      for (const state of nonRepayable) {
        expect(isRepayableLoanState(state)).toBe(false)
      }
    })
  })
})
