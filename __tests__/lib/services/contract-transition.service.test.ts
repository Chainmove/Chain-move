// @vitest-environment node
import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  ContractConcurrencyError,
  transitionHirePurchaseContract,
} from "@/lib/services/contract-transition.service"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

async function createDriver(kycStatus = "approved_stage2") {
  return User.create({ name: "Test Driver", role: "driver", kycStatus })
}

async function createVehicle(status = "Available") {
  return Vehicle.create({
    name: "Test Shuttle",
    type: "SHUTTLE",
    year: 2022,
    price: 5_000_000,
    roi: 12,
    status,
    specifications: {},
  })
}

async function createContract(overrides: Record<string, unknown> = {}) {
  return HirePurchaseContract.create({
    driverUserId: new mongoose.Types.ObjectId(),
    poolId: new mongoose.Types.ObjectId(),
    assetType: "SHUTTLE",
    vehicleDisplayName: "Test Shuttle",
    principalNgn: 4_000_000,
    depositNgn: 500_000,
    totalPayableNgn: 4_500_000,
    durationWeeks: 45,
    weeklyPaymentNgn: 100_000,
    startDate: new Date("2026-01-01"),
    status: "PENDING_APPROVAL",
    ...overrides,
  })
}

describe("transitionHirePurchaseContract", () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI)
  })

  afterEach(async () => {
    await Promise.all([HirePurchaseContract.deleteMany({}), User.deleteMany({}), Vehicle.deleteMany({})])
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  it("walks a contract through approval, vehicle assignment, and activation", async () => {
    const driver = await createDriver()
    const vehicle = await createVehicle()
    const contract = await createContract({ driverUserId: driver._id })

    await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "APPROVED",
      actor: { type: "admin", userId: new mongoose.Types.ObjectId().toString() },
      reason: "Terms reviewed and approved.",
    })

    await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "VEHICLE_ASSIGNED",
      actor: { type: "admin" },
      reason: "Vehicle allocated to driver.",
      vehicleId: vehicle._id.toString(),
    })

    const { contract: activated } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "ACTIVE",
      actor: { type: "admin" },
      reason: "Driver KYC approved, vehicle handed over, schedule generated.",
    })

    expect(activated.status).toBe("ACTIVE")
    expect(activated.version).toBe(3)
    expect(activated.timeline).toHaveLength(3)

    const vehicleAfter = await Vehicle.findById(vehicle._id).lean<any>()
    expect(vehicleAfter?.status).toBe("Financed")
    expect(vehicleAfter?.driverId?.toString()).toBe(driver._id.toString())
  })

  it("rejects an invalid transition with a domain error", async () => {
    const contract = await createContract()
    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "ACTIVE",
        actor: { type: "admin" },
        reason: "Skip ahead",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("blocks activation without approved KYC", async () => {
    const driver = await createDriver("pending")
    const vehicle = await createVehicle()
    const contract = await createContract({
      driverUserId: driver._id,
      status: "VEHICLE_ASSIGNED",
      vehicleId: vehicle._id,
    })

    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "ACTIVE",
        actor: { type: "admin" },
        reason: "Attempt activation",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("blocks activation when no repayment schedule can be generated from the contract terms", async () => {
    const driver = await createDriver()
    const vehicle = await createVehicle()
    const contract = await createContract({
      driverUserId: driver._id,
      status: "VEHICLE_ASSIGNED",
      vehicleId: vehicle._id,
      weeklyPaymentNgn: 0,
    })

    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "ACTIVE",
        actor: { type: "admin" },
        reason: "Attempt activation",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("rejects actors who are not permitted to drive a transition", async () => {
    const contract = await createContract()
    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "APPROVED",
        actor: { type: "driver" },
        reason: "Driver tries to self-approve",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" })
  })

  it("detects a competing transition via optimistic concurrency and lets only one succeed", async () => {
    const contract = await createContract()

    await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "APPROVED",
      actor: { type: "admin" },
      reason: "First transition bumps the version to 1.",
    })

    // A second actor still holding the stale version 0 (read before the first
    // transition committed) must not be able to silently overwrite it.
    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "CANCELLED",
        actor: { type: "admin" },
        reason: "Competing transition using a stale version",
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ContractConcurrencyError)

    const reloaded = await HirePurchaseContract.findById(contract._id).lean<any>()
    expect(reloaded?.status).toBe("APPROVED")
    expect(reloaded?.version).toBe(1)
  })

  it("rolls back the contract and vehicle updates when the enclosing transaction is aborted", async () => {
    const driver = await createDriver()
    const vehicle = await createVehicle()
    const contract = await createContract({
      driverUserId: driver._id,
      status: "VEHICLE_ASSIGNED",
      vehicleId: vehicle._id,
    })

    const session = await mongoose.startSession()
    session.startTransaction()
    try {
      await transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "ACTIVE",
        actor: { type: "admin" },
        reason: "Activation that will be rolled back by the caller.",
        session,
      })
      throw new Error("Simulated downstream failure forcing a caller-level rollback.")
    } catch {
      await session.abortTransaction()
    } finally {
      session.endSession()
    }

    const reloaded = await HirePurchaseContract.findById(contract._id).lean<any>()
    expect(reloaded?.status).toBe("VEHICLE_ASSIGNED")
    expect(reloaded?.version).toBe(0)

    const vehicleAfter = await Vehicle.findById(vehicle._id).lean<any>()
    expect(vehicleAfter?.status).toBe("Available")
  })

  it("restructures an active contract's terms and records the change in the timeline", async () => {
    const contract = await createContract({ status: "ACTIVE" })

    const { contract: restructured } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "RESTRUCTURED",
      actor: { type: "admin" },
      reason: "Driver requested an extended term after an income shock.",
      restructure: { durationWeeks: 60, weeklyPaymentNgn: 75_000 },
    })

    expect(restructured.status).toBe("RESTRUCTURED")
    expect(restructured.durationWeeks).toBe(60)
    expect(restructured.weeklyPaymentNgn).toBe(75_000)
    expect(restructured.timeline[0].toState).toBe("RESTRUCTURED")
  })

  it("requires at least one updated term to restructure", async () => {
    const contract = await createContract({ status: "ACTIVE" })
    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "RESTRUCTURED",
        actor: { type: "admin" },
        reason: "No new terms supplied",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("supports early settlement: completes a delinquent contract once the balance is fully paid", async () => {
    const contract = await createContract({
      status: "DELINQUENT",
      totalPayableNgn: 1_000_000,
      totalPaidNgn: 1_000_000,
    })

    const { contract: completed } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "COMPLETED",
      actor: { type: "system" },
      reason: "Driver paid off the remaining balance early.",
    })

    expect(completed.status).toBe("COMPLETED")
  })

  it("blocks completion while a payable balance remains", async () => {
    const contract = await createContract({
      status: "ACTIVE",
      totalPayableNgn: 1_000_000,
      totalPaidNgn: 400_000,
    })

    await expect(
      transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "COMPLETED",
        actor: { type: "system" },
        reason: "Attempt early completion",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("repossesses a vehicle and releases it back to the fleet", async () => {
    const driver = await createDriver()
    const vehicle = await createVehicle("Financed")
    await Vehicle.updateOne({ _id: vehicle._id }, { $set: { driverId: driver._id } })
    const contract = await createContract({
      driverUserId: driver._id,
      status: "DELINQUENT",
      vehicleId: vehicle._id,
    })

    const { contract: repossessed } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "REPOSSESSED",
      actor: { type: "admin" },
      reason: "Driver failed to cure delinquency within the grace period.",
    })

    expect(repossessed.status).toBe("REPOSSESSED")
    const vehicleAfter = await Vehicle.findById(vehicle._id).lean<any>()
    expect(vehicleAfter?.status).toBe("Reserved")
    expect(vehicleAfter?.driverId).toBeFalsy()
  })

  it("flags rather than silently skipping vehicle sync for legacy contracts with no linked vehicle", async () => {
    const contract = await createContract({ status: "DELINQUENT" }) // no vehicleId

    const { contract: repossessed } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "REPOSSESSED",
      actor: { type: "admin" },
      reason: "Legacy contract repossession with no vehicle link.",
    })

    const lastEntry = repossessed.timeline[repossessed.timeline.length - 1]
    expect(lastEntry.metadata?.vehicleSyncSkipped).toBe(true)
  })

  it("lets a driver cancel their own contract before activation, but not once it is active", async () => {
    const driver = await createDriver()
    const contract = await createContract({ driverUserId: driver._id, status: "PENDING_APPROVAL" })

    const { contract: cancelled } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "CANCELLED",
      actor: { type: "driver", userId: driver._id.toString() },
      reason: "Driver withdrew before approval.",
    })
    expect(cancelled.status).toBe("CANCELLED")

    const activeContract = await createContract({ driverUserId: driver._id, status: "ACTIVE" })
    await expect(
      transitionHirePurchaseContract({
        contractId: activeContract._id.toString(),
        targetState: "CANCELLED",
        actor: { type: "driver", userId: driver._id.toString() },
        reason: "Driver tries to cancel an active contract",
      }),
    ).rejects.toThrow()
  })

  it("reopens a COMPLETED contract via the data-integrity repair engine's reconciliation path", async () => {
    const contract = await createContract({
      status: "COMPLETED",
      totalPayableNgn: 1_000_000,
      totalPaidNgn: 400_000,
    })

    const { contract: reopened } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "ACTIVE",
      actor: { type: "system" },
      reason: "Data-integrity repair: COMPLETED contract has a remaining balance.",
    })

    expect(reopened.status).toBe("ACTIVE")
  })

  it("treats a same-state call as a no-op (idempotent, no version bump)", async () => {
    const contract = await createContract({ status: "ACTIVE" })
    const { contract: unchanged, previousState } = await transitionHirePurchaseContract({
      contractId: contract._id.toString(),
      targetState: "ACTIVE",
      actor: { type: "system" },
      reason: "No-op",
    })
    expect(previousState).toBe("ACTIVE")
    expect(unchanged.version).toBe(0)
  })

  it("remains transitionable for legacy documents written before the `version` field existed", async () => {
    const raw = await HirePurchaseContract.collection.insertOne({
      driverUserId: new mongoose.Types.ObjectId(),
      poolId: new mongoose.Types.ObjectId(),
      assetType: "SHUTTLE",
      vehicleDisplayName: "Legacy Shuttle",
      principalNgn: 1_000_000,
      depositNgn: 0,
      totalPayableNgn: 1_000_000,
      durationWeeks: 10,
      weeklyPaymentNgn: 100_000,
      startDate: new Date("2024-01-01"),
      status: "ACTIVE",
      totalPaidNgn: 1_000_000,
      nextDueDate: null,
      // Deliberately no `version` and no `timeline` field, simulating a
      // pre-migration document inserted before this feature existed.
    })

    const { contract: completed } = await transitionHirePurchaseContract({
      contractId: raw.insertedId.toString(),
      targetState: "COMPLETED",
      actor: { type: "system" },
      reason: "Legacy contract fully paid.",
    })

    expect(completed.status).toBe("COMPLETED")
    expect(completed.version).toBe(1)
  })
})
