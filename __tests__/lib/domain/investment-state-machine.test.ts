// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  isValidInvestmentTransition,
  isInvestmentActorAllowed,
  isTerminalInvestmentState,
  INVESTMENT_VALID_TRANSITIONS,
  type InvestmentStatus,
} from "@/lib/domain/investment-state-machine"

const ALL_STATES: InvestmentStatus[] = ["Funding", "Active", "Completed"]

describe("Investment state machine", () => {
  describe("isValidInvestmentTransition", () => {
    it("allows any state from null (initial creation)", () => {
      for (const state of ALL_STATES) {
        expect(isValidInvestmentTransition(null, state)).toBe(true)
      }
    })

    it("allows same-state no-op transitions", () => {
      for (const state of ALL_STATES) {
        expect(isValidInvestmentTransition(state, state)).toBe(true)
      }
    })

    it("walks the lifecycle: Funding -> Active -> Completed", () => {
      expect(isValidInvestmentTransition("Funding", "Active")).toBe(true)
      expect(isValidInvestmentTransition("Active", "Completed")).toBe(true)
    })

    it("rejects skipping Funding directly to Completed", () => {
      expect(isValidInvestmentTransition("Funding", "Completed")).toBe(false)
    })

    it("rejects any transition out of Completed (terminal)", () => {
      expect(isValidInvestmentTransition("Completed", "Funding")).toBe(false)
      expect(isValidInvestmentTransition("Completed", "Active")).toBe(false)
    })

    it("rejects reverting Active to Funding", () => {
      expect(isValidInvestmentTransition("Active", "Funding")).toBe(false)
    })

    it("every listed transition target is a known status", () => {
      for (const [from, targets] of Object.entries(INVESTMENT_VALID_TRANSITIONS)) {
        expect(ALL_STATES).toContain(from as InvestmentStatus)
        for (const target of targets) {
          expect(ALL_STATES).toContain(target)
        }
      }
    })
  })

  describe("isInvestmentActorAllowed", () => {
    it("admin and system can activate", () => {
      expect(isInvestmentActorAllowed("Active", "admin")).toBe(true)
      expect(isInvestmentActorAllowed("Active", "system")).toBe(true)
    })

    it("admin and system can complete", () => {
      expect(isInvestmentActorAllowed("Completed", "admin")).toBe(true)
      expect(isInvestmentActorAllowed("Completed", "system")).toBe(true)
    })

    it("no actor is allowed to transition into Funding directly", () => {
      expect(isInvestmentActorAllowed("Funding", "admin")).toBe(false)
      expect(isInvestmentActorAllowed("Funding", "system")).toBe(false)
    })
  })

  describe("isTerminalInvestmentState", () => {
    it("marks Completed as terminal", () => {
      expect(isTerminalInvestmentState("Completed")).toBe(true)
    })

    it("does not mark non-Completed states as terminal", () => {
      expect(isTerminalInvestmentState("Funding")).toBe(false)
      expect(isTerminalInvestmentState("Active")).toBe(false)
    })
  })
})
