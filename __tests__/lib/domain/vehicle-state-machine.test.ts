// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  isValidVehicleTransition,
  isVehicleActorAllowed,
  isTerminalVehicleStatus,
  isValidVehicleFundingTransition,
  VEHICLE_VALID_TRANSITIONS,
  VEHICLE_FUNDING_TRANSITIONS,
  type VehicleStatus,
  type VehicleFundingStatus,
} from "@/lib/domain/vehicle-state-machine"

const ALL_STATUSES: VehicleStatus[] = [
  "Available",
  "Reserved",
  "Financed",
  "Maintenance",
  "Retired",
]

const ALL_FUNDING_STATUSES: VehicleFundingStatus[] = ["Open", "Funded", "Active"]

describe("Vehicle state machine", () => {
  describe("isValidVehicleTransition", () => {
    it("allows any status from null (initial)", () => {
      for (const status of ALL_STATUSES) {
        expect(isValidVehicleTransition(null, status)).toBe(true)
      }
    })

    it("allows same-status no-op transitions", () => {
      for (const status of ALL_STATUSES) {
        expect(isValidVehicleTransition(status, status)).toBe(true)
      }
    })

    it("walks the reservation → financing lifecycle", () => {
      expect(isValidVehicleTransition("Available", "Reserved")).toBe(true)
      expect(isValidVehicleTransition("Reserved", "Financed")).toBe(true)
    })

    it("allows releasing a reservation back to Available", () => {
      expect(isValidVehicleTransition("Reserved", "Available")).toBe(true)
    })

    it("allows a financed vehicle to return to Available on loan completion", () => {
      expect(isValidVehicleTransition("Financed", "Available")).toBe(true)
    })

    it("allows entering maintenance from Available, Reserved, and Financed", () => {
      expect(isValidVehicleTransition("Available", "Maintenance")).toBe(true)
      expect(isValidVehicleTransition("Reserved", "Maintenance")).toBe(true)
      expect(isValidVehicleTransition("Financed", "Maintenance")).toBe(true)
    })

    it("allows exiting maintenance back to Available", () => {
      expect(isValidVehicleTransition("Maintenance", "Available")).toBe(true)
    })

    it("allows retirement from Available, Financed, and Maintenance", () => {
      expect(isValidVehicleTransition("Available", "Retired")).toBe(true)
      expect(isValidVehicleTransition("Financed", "Retired")).toBe(true)
      expect(isValidVehicleTransition("Maintenance", "Retired")).toBe(true)
    })

    it("rejects any transition out of Retired (terminal)", () => {
      for (const status of ALL_STATUSES) {
        if (status === "Retired") continue
        expect(isValidVehicleTransition("Retired", status)).toBe(false)
      }
    })

    it("rejects Maintenance -> Reserved (must exit to Available first)", () => {
      expect(isValidVehicleTransition("Maintenance", "Reserved")).toBe(false)
    })

    it("rejects skipping reservation (Available -> Financed)", () => {
      expect(isValidVehicleTransition("Available", "Financed")).toBe(false)
    })

    it("every listed transition target is a known status", () => {
      for (const [from, targets] of Object.entries(VEHICLE_VALID_TRANSITIONS)) {
        expect(ALL_STATUSES).toContain(from as VehicleStatus)
        for (const target of targets) {
          expect(ALL_STATUSES).toContain(target)
        }
      }
    })
  })

  describe("isVehicleActorAllowed", () => {
    it("admin and system can reserve a vehicle", () => {
      expect(isVehicleActorAllowed("Reserved", "admin")).toBe(true)
      expect(isVehicleActorAllowed("Reserved", "system")).toBe(true)
    })

    it("admin and system can finalize financing", () => {
      expect(isVehicleActorAllowed("Financed", "admin")).toBe(true)
      expect(isVehicleActorAllowed("Financed", "system")).toBe(true)
    })

    it("only admin can enter maintenance", () => {
      expect(isVehicleActorAllowed("Maintenance", "admin")).toBe(true)
      expect(isVehicleActorAllowed("Maintenance", "system")).toBe(false)
    })

    it("only admin can retire a vehicle", () => {
      expect(isVehicleActorAllowed("Retired", "admin")).toBe(true)
      expect(isVehicleActorAllowed("Retired", "system")).toBe(false)
    })

    it("admin and system can move vehicle to Available", () => {
      expect(isVehicleActorAllowed("Available", "admin")).toBe(true)
      expect(isVehicleActorAllowed("Available", "system")).toBe(true)
    })
  })

  describe("isTerminalVehicleStatus", () => {
    it("marks Retired as terminal", () => {
      expect(isTerminalVehicleStatus("Retired")).toBe(true)
    })

    it("does not mark non-Retired statuses as terminal", () => {
      expect(isTerminalVehicleStatus("Available")).toBe(false)
      expect(isTerminalVehicleStatus("Reserved")).toBe(false)
      expect(isTerminalVehicleStatus("Financed")).toBe(false)
      expect(isTerminalVehicleStatus("Maintenance")).toBe(false)
    })
  })

  describe("isValidVehicleFundingTransition", () => {
    it("allows same-status no-op", () => {
      for (const status of ALL_FUNDING_STATUSES) {
        expect(isValidVehicleFundingTransition(status, status)).toBe(true)
      }
    })

    it("walks the funding lifecycle Open -> Funded -> Active", () => {
      expect(isValidVehicleFundingTransition("Open", "Funded")).toBe(true)
      expect(isValidVehicleFundingTransition("Funded", "Active")).toBe(true)
    })

    it("allows reverting from Funded to Open (loan rejected before activation)", () => {
      expect(isValidVehicleFundingTransition("Funded", "Open")).toBe(true)
    })

    it("allows admin override from Active back to Funded", () => {
      expect(isValidVehicleFundingTransition("Active", "Funded")).toBe(true)
    })

    it("rejects skipping from Open directly to Active", () => {
      expect(isValidVehicleFundingTransition("Open", "Active")).toBe(false)
    })

    it("every listed transition target is a known funding status", () => {
      for (const [from, targets] of Object.entries(VEHICLE_FUNDING_TRANSITIONS)) {
        expect(ALL_FUNDING_STATUSES).toContain(from as VehicleFundingStatus)
        for (const target of targets) {
          expect(ALL_FUNDING_STATUSES).toContain(target)
        }
      }
    })
  })
})
