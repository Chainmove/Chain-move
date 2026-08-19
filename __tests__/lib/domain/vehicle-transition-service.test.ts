// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import mongoose from "mongoose"

import Vehicle from "@/models/Vehicle"
import Loan from "@/models/Loan"
import User from "@/models/User"
import StateTransitionHistory from "@/models/StateTransitionHistory"
import {
  transitionVehicle,
  DomainTransitionError,
  DomainConcurrencyError,
} from "@/lib/domain/vehicle-transition-service"

const TEST_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

beforeAll(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 })
  } catch {
    console.warn("MongoDB not available — skipping vehicle service tests")
  }
}, 10000)

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
  }
})

function skip() {
  return mongoose.connection.readyState !== 1
}

async function makeVehicle(overrides: Record<string, unknown> = {}) {
  return Vehicle.create({
    name: "Test Shuttle",
    type: "shuttle",
    year: 2023,
    price: 600000,
    roi: 12,
    status: "Available",
    fundingStatus: "Open",
    specifications: {
      engine: "2.5L",
      fuelType: "petrol",
      mileage: "25km/l",
      transmission: "automatic",
      color: "blue",
      vin: `VIN-V-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    ...overrides,
  })
}

async function makeUser(role = "admin") {
  return User.create({
    name: `Vehicle Test ${role}`,
    email: `v-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    role,
  })
}

describe("Vehicle transition service", () => {
  let adminUser: any
  let driverUser: any

  beforeEach(async () => {
    if (skip()) return
    adminUser = await makeUser("admin")
    driverUser = await makeUser("driver")
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("reserves an available vehicle", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    const result = await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "reserve",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Loan application received",
    })
    expect(result.previousStatus).toBe("Available")
    expect(result.nextStatus).toBe("Reserved")
  })

  it("finalizes a reserved vehicle to Financed", async () => {
    if (skip()) return
    const vehicle = await makeVehicle({ status: "Reserved" })
    const result = await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "assignDriver",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Loan activated",
      driverId: driverUser._id.toString(),
    })
    expect(result.nextStatus).toBe("Financed")
    expect(result.vehicle.fundingStatus).toBe("Active")
  })

  it("releases a reservation back to Available", async () => {
    if (skip()) return
    const vehicle = await makeVehicle({ status: "Reserved", driverId: driverUser._id })
    const result = await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "releaseReservation",
      actor: { type: "system" },
      reason: "Loan rejected",
    })
    expect(result.nextStatus).toBe("Available")
    const updated = await Vehicle.findById(vehicle._id)
    expect(updated!.driverId).toBeUndefined()
  })

  it("enters and exits maintenance", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "enterMaintenance",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Scheduled service",
    })
    let updated = await Vehicle.findById(vehicle._id)
    expect(updated!.status).toBe("Maintenance")

    await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "exitMaintenance",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Service complete",
    })
    updated = await Vehicle.findById(vehicle._id)
    expect(updated!.status).toBe("Available")
  })

  it("retires a vehicle", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    const result = await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "retire",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "End of service life",
    })
    expect(result.nextStatus).toBe("Retired")
  })

  it("records transition history", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "reserve",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "History test",
    })
    const history = await StateTransitionHistory.findOne({
      entityType: "vehicle",
      entityId: vehicle._id,
    })
    expect(history).not.toBeNull()
    expect(history!.fromState).toBe("Available")
    expect(history!.toState).toBe("Reserved")
  })

  // ── Forbidden transitions ──────────────────────────────────────────────────

  it("rejects any transition from Retired (terminal)", async () => {
    if (skip()) return
    const vehicle = await makeVehicle({ status: "Retired" })
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "reserve",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Trying to reactivate retired vehicle",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("rejects skipping reservation (Available -> Financed)", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "assignDriver",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Trying to skip reservation",
        driverId: driverUser._id.toString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("rejects finalize without driverId", async () => {
    if (skip()) return
    const vehicle = await makeVehicle({ status: "Reserved" })
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "assignDriver",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Missing driverId",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("rejects entering maintenance while active loan exists", async () => {
    if (skip()) return
    const vehicle = await makeVehicle({ status: "Financed" })
    const driver = await makeUser("driver")
    await Loan.create({
      driverId: driver._id,
      vehicleId: vehicle._id,
      requestedAmount: 600000,
      totalFunded: 600000,
      fundingProgress: 100,
      loanTerm: 12,
      monthlyPayment: 55000,
      weeklyPayment: 14000,
      interestRate: 8,
      status: "Active",
      version: 0,
    })
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "enterMaintenance",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Trying maintenance during active loan",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("rejects stale version (concurrent transition)", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await transitionVehicle({
      vehicleId: vehicle._id.toString(),
      command: "reserve",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "First transition",
    })
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "releaseReservation",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Concurrent release",
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(DomainConcurrencyError)
  })

  it("requires a reason", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "reserve",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "",
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" })
  })

  it("system cannot enter maintenance (admin-only command)", async () => {
    if (skip()) return
    const vehicle = await makeVehicle()
    await expect(
      transitionVehicle({
        vehicleId: vehicle._id.toString(),
        command: "enterMaintenance",
        actor: { type: "system" },
        reason: "System-triggered maintenance",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" })
  })
})
