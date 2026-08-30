// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  isActorAllowedForTransition,
  isPreActivationState,
  isRepayableState,
  isValidTransition,
  VALID_TRANSITIONS,
} from "@/lib/contracts/state-machine"
import { HirePurchaseContractStatus } from "@/models/HirePurchaseContract"

const ALL_STATES: HirePurchaseContractStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "VEHICLE_ASSIGNED",
  "ACTIVE",
  "DELINQUENT",
  "RESTRUCTURED",
  "COMPLETED",
  "REPOSSESSED",
  "CANCELLED",
  "CLOSED",
]

describe("Hire-purchase contract state machine", () => {
  it("allows every state to transition to itself (no-op)", () => {
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(true)
    }
  })

  it("allows any target state as the initial transition (fromState = null)", () => {
    expect(isValidTransition(null, "PENDING_APPROVAL")).toBe(true)
  })

  it("walks the full happy-path lifecycle", () => {
    expect(isValidTransition("PENDING_APPROVAL", "APPROVED")).toBe(true)
    expect(isValidTransition("APPROVED", "VEHICLE_ASSIGNED")).toBe(true)
    expect(isValidTransition("VEHICLE_ASSIGNED", "ACTIVE")).toBe(true)
    expect(isValidTransition("ACTIVE", "COMPLETED")).toBe(true)
    expect(isValidTransition("COMPLETED", "CLOSED")).toBe(true)
  })

  it("supports delinquency, cure, restructuring, and repossession", () => {
    expect(isValidTransition("ACTIVE", "DELINQUENT")).toBe(true)
    expect(isValidTransition("DELINQUENT", "ACTIVE")).toBe(true)
    expect(isValidTransition("ACTIVE", "RESTRUCTURED")).toBe(true)
    expect(isValidTransition("RESTRUCTURED", "DELINQUENT")).toBe(true)
    expect(isValidTransition("DELINQUENT", "REPOSSESSED")).toBe(true)
    expect(isValidTransition("RESTRUCTURED", "REPOSSESSED")).toBe(true)
    expect(isValidTransition("REPOSSESSED", "CLOSED")).toBe(true)
  })

  it("supports early settlement (completion from a non-ACTIVE current state)", () => {
    expect(isValidTransition("DELINQUENT", "COMPLETED")).toBe(true)
    expect(isValidTransition("RESTRUCTURED", "COMPLETED")).toBe(true)
  })

  it("supports pre-activation cancellation", () => {
    expect(isValidTransition("PENDING_APPROVAL", "CANCELLED")).toBe(true)
    expect(isValidTransition("APPROVED", "CANCELLED")).toBe(true)
    expect(isValidTransition("VEHICLE_ASSIGNED", "CANCELLED")).toBe(true)
    expect(isValidTransition("CANCELLED", "CLOSED")).toBe(true)
  })

  it("supports the COMPLETED -> ACTIVE reconciliation path used by the data-integrity repair engine", () => {
    expect(isValidTransition("COMPLETED", "ACTIVE")).toBe(true)
  })

  it("rejects skipping the pre-activation sequence", () => {
    expect(isValidTransition("PENDING_APPROVAL", "ACTIVE")).toBe(false)
    expect(isValidTransition("PENDING_APPROVAL", "VEHICLE_ASSIGNED")).toBe(false)
    expect(isValidTransition("APPROVED", "ACTIVE")).toBe(false)
  })

  it("rejects cancelling a contract once it is active or beyond", () => {
    expect(isValidTransition("ACTIVE", "CANCELLED")).toBe(false)
    expect(isValidTransition("DELINQUENT", "CANCELLED")).toBe(false)
    expect(isValidTransition("RESTRUCTURED", "CANCELLED")).toBe(false)
  })

  it("rejects any transition out of a CLOSED (terminal) contract", () => {
    for (const state of ALL_STATES) {
      if (state === "CLOSED") continue
      expect(isValidTransition("CLOSED", state)).toBe(false)
    }
  })

  it("rejects REPOSSESSED and CANCELLED ever reaching COMPLETED", () => {
    expect(isValidTransition("REPOSSESSED", "COMPLETED")).toBe(false)
    expect(isValidTransition("CANCELLED", "COMPLETED")).toBe(false)
  })

  it("every listed transition target is a real, known status (no typos in the table)", () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(ALL_STATES).toContain(from as HirePurchaseContractStatus)
      for (const target of targets) {
        expect(ALL_STATES).toContain(target)
      }
    }
  })

  it("classifies pre-activation states correctly", () => {
    expect(isPreActivationState("PENDING_APPROVAL")).toBe(true)
    expect(isPreActivationState("APPROVED")).toBe(true)
    expect(isPreActivationState("VEHICLE_ASSIGNED")).toBe(true)
    expect(isPreActivationState("ACTIVE")).toBe(false)
    expect(isPreActivationState("CLOSED")).toBe(false)
  })

  it("only ACTIVE, DELINQUENT and RESTRUCTURED are repayable", () => {
    expect(isRepayableState("ACTIVE")).toBe(true)
    expect(isRepayableState("DELINQUENT")).toBe(true)
    expect(isRepayableState("RESTRUCTURED")).toBe(true)
    expect(isRepayableState("PENDING_APPROVAL")).toBe(false)
    expect(isRepayableState("COMPLETED")).toBe(false)
    expect(isRepayableState(null)).toBe(false)
    expect(isRepayableState(undefined)).toBe(false)
  })

  describe("actor permissions", () => {
    it("only admins can approve, assign a vehicle, restructure, or repossess", () => {
      expect(isActorAllowedForTransition("APPROVED", "PENDING_APPROVAL", "admin")).toBe(true)
      expect(isActorAllowedForTransition("APPROVED", "PENDING_APPROVAL", "driver")).toBe(false)
      expect(isActorAllowedForTransition("APPROVED", "PENDING_APPROVAL", "system")).toBe(false)

      expect(isActorAllowedForTransition("VEHICLE_ASSIGNED", "APPROVED", "admin")).toBe(true)
      expect(isActorAllowedForTransition("VEHICLE_ASSIGNED", "APPROVED", "driver")).toBe(false)

      expect(isActorAllowedForTransition("RESTRUCTURED", "ACTIVE", "admin")).toBe(true)
      expect(isActorAllowedForTransition("RESTRUCTURED", "ACTIVE", "system")).toBe(false)

      expect(isActorAllowedForTransition("REPOSSESSED", "DELINQUENT", "admin")).toBe(true)
      expect(isActorAllowedForTransition("REPOSSESSED", "DELINQUENT", "system")).toBe(false)
    })

    it("admin and system can both activate/cure and complete", () => {
      expect(isActorAllowedForTransition("ACTIVE", "VEHICLE_ASSIGNED", "admin")).toBe(true)
      expect(isActorAllowedForTransition("ACTIVE", "VEHICLE_ASSIGNED", "system")).toBe(true)
      expect(isActorAllowedForTransition("ACTIVE", "VEHICLE_ASSIGNED", "driver")).toBe(false)

      expect(isActorAllowedForTransition("COMPLETED", "ACTIVE", "admin")).toBe(true)
      expect(isActorAllowedForTransition("COMPLETED", "ACTIVE", "system")).toBe(true)
      expect(isActorAllowedForTransition("COMPLETED", "ACTIVE", "driver")).toBe(false)
    })

    it("a driver may cancel their own contract only before activation", () => {
      expect(isActorAllowedForTransition("CANCELLED", "PENDING_APPROVAL", "driver")).toBe(true)
      expect(isActorAllowedForTransition("CANCELLED", "APPROVED", "driver")).toBe(true)
      expect(isActorAllowedForTransition("CANCELLED", "VEHICLE_ASSIGNED", "driver")).toBe(true)
    })

    it("an admin may cancel from any pre-activation state, distinct from a driver's own action", () => {
      expect(isActorAllowedForTransition("CANCELLED", "PENDING_APPROVAL", "admin")).toBe(true)
      expect(isActorAllowedForTransition("CANCELLED", "APPROVED", "admin")).toBe(true)
    })
  })
})
