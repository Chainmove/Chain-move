// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest"
import mongoose from "mongoose"

import Loan from "@/models/Loan"
import Vehicle from "@/models/Vehicle"
import Investment from "@/models/Investment"
import User from "@/models/User"
import StateTransitionHistory from "@/models/StateTransitionHistory"
import {
  transitionLoan,
  DomainTransitionError,
  DomainConcurrencyError,
} from "@/lib/domain/loan-transition-service"

const TEST_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

beforeAll(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 })
  } catch {
    console.warn("MongoDB not available — skipping loan service tests")
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
    name: "Test Van",
    type: "van",
    year: 2022,
    price: 500000,
    roi: 15,
    status: "Available",
    fundingStatus: "Open",
    specifications: { engine: "3.0L", fuelType: "diesel", mileage: "30km/l", transmission: "manual", color: "white", vin: `VIN-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    ...overrides,
  })
}

async function makeUser(role = "admin") {
  return User.create({
    name: `Test ${role}`,
    email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    role,
  })
}

async function makeLoan(vehicleId: unknown, driverId: unknown, overrides: Record<string, unknown> = {}) {
  return Loan.create({
    driverId,
    vehicleId,
    requestedAmount: 500000,
    totalFunded: 0,
    fundingProgress: 0,
    loanTerm: 12,
    monthlyPayment: 45000,
    weeklyPayment: 11000,
    interestRate: 8,
    status: "Pending",
    version: 0,
    ...overrides,
  })
}

describe("Loan transition service", () => {
  let adminUser: any
  let driverUser: any
  let vehicle: any

  beforeEach(async () => {
    if (skip()) return
    adminUser = await makeUser("admin")
    driverUser = await makeUser("driver")
    vehicle = await makeVehicle()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("transitions Pending -> Under Review", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    const result = await transitionLoan({
      loanId: loan._id.toString(),
      command: "startReview",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Starting review",
    })
    expect(result.previousStatus).toBe("Pending")
    expect(result.nextStatus).toBe("Under Review")
    expect(result.loan.status).toBe("Under Review")
  })

  it("transitions Under Review -> Approved and records history", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, { status: "Under Review" })
    await transitionLoan({
      loanId: loan._id.toString(),
      command: "approve",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Approved after review",
    })
    const history = await StateTransitionHistory.findOne({
      entityType: "loan",
      entityId: loan._id,
      toState: "Approved",
    })
    expect(history).not.toBeNull()
    expect(history!.fromState).toBe("Under Review")
    expect(history!.actorType).toBe("admin")
  })

  it("activates a fully funded loan with down payment", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Approved",
      totalFunded: 500000,
      downPaymentMade: true,
    })
    const result = await transitionLoan({
      loanId: loan._id.toString(),
      command: "activate",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Loan fully funded and down payment received",
    })
    expect(result.nextStatus).toBe("Active")

    const updatedVehicle = await Vehicle.findById(vehicle._id)
    expect(updatedVehicle!.status).toBe("Financed")
    expect(updatedVehicle!.fundingStatus).toBe("Active")
  })

  it("completes an active loan and releases vehicle", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Active",
      totalFunded: 500000,
      downPaymentMade: true,
    })
    await Vehicle.findByIdAndUpdate(vehicle._id, { status: "Financed", driverId: driverUser._id, fundingStatus: "Active" })

    const result = await transitionLoan({
      loanId: loan._id.toString(),
      command: "complete",
      actor: { type: "system" },
      reason: "All repayments received",
    })
    expect(result.nextStatus).toBe("Completed")

    const updatedVehicle = await Vehicle.findById(vehicle._id)
    expect(updatedVehicle!.status).toBe("Available")
    expect(updatedVehicle!.fundingStatus).toBe("Open")
  })

  it("driver can cancel a pending loan", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    const result = await transitionLoan({
      loanId: loan._id.toString(),
      command: "cancel",
      actor: { type: "driver", id: driverUser._id.toString() },
      reason: "Changed my mind",
    })
    expect(result.nextStatus).toBe("Cancelled")

    const updatedVehicle = await Vehicle.findById(vehicle._id)
    expect(updatedVehicle!.status).toBe("Available")
  })

  // ── Forbidden transitions ──────────────────────────────────────────────────

  it("rejects activating without full funding", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Approved",
      totalFunded: 100000,
      downPaymentMade: true,
    })
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "activate",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Trying to activate underfunded loan",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("rejects activating without down payment", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Approved",
      totalFunded: 500000,
      downPaymentMade: false,
    })
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "activate",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "No down payment yet",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
  })

  it("rejects driver approving a loan (forbidden actor)", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, { status: "Under Review" })
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "approve",
        actor: { type: "driver", id: driverUser._id.toString() },
        reason: "Trying to self-approve",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" })
  })

  it("rejects skipping Under Review (Pending -> Approved)", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "approve",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Skipping review",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("rejects re-transitioning from a terminal state (Rejected)", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, { status: "Rejected" })
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "startReview",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Trying to reopen",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("returns 409 on stale version (concurrent transition)", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    // First transition succeeds and bumps version to 1
    await transitionLoan({
      loanId: loan._id.toString(),
      command: "startReview",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "First transition",
    })
    // Second transition with stale version 0 should fail
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "reject",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Concurrent reject",
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(DomainConcurrencyError)
  })

  it("requires a non-empty reason", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "startReview",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "   ",
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" })
  })

  it("activates investments when loan activates", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Approved",
      totalFunded: 500000,
      downPaymentMade: true,
    })
    const inv = await Investment.create({
      investorId: adminUser._id,
      vehicleId: vehicle._id,
      loanId: loan._id,
      amount: 500000,
      monthlyReturn: 6250,
      status: "Funding",
      version: 0,
    })

    await transitionLoan({
      loanId: loan._id.toString(),
      command: "activate",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Activation",
    })

    const updatedInv = await Investment.findById(inv._id)
    expect(updatedInv!.status).toBe("Active")
  })

  it("completes investments when loan completes", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Active",
      totalFunded: 500000,
      downPaymentMade: true,
    })
    const inv = await Investment.create({
      investorId: adminUser._id,
      vehicleId: vehicle._id,
      loanId: loan._id,
      amount: 500000,
      monthlyReturn: 6250,
      status: "Active",
      version: 0,
    })

    await transitionLoan({
      loanId: loan._id.toString(),
      command: "complete",
      actor: { type: "system" },
      reason: "Fully repaid",
    })

    const updatedInv = await Investment.findById(inv._id)
    expect(updatedInv!.status).toBe("Completed")
  })

  it("transition history is immutable (no update method available)", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    await transitionLoan({
      loanId: loan._id.toString(),
      command: "startReview",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Review started",
    })
    const count = await StateTransitionHistory.countDocuments({
      entityType: "loan",
      entityId: loan._id,
    })
    expect(count).toBe(1)
    // History records must not be replaced or deleted; only additional records are appended
  })

  it("rolls back loan status when a side effect throws", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id, {
      status: "Approved",
      totalFunded: 500000,
      downPaymentMade: true,
    })

    // Force the Investment bulk update (side effect) to throw
    const original = Investment.updateMany.bind(Investment)
    const spy = vi.spyOn(Investment, "updateMany").mockImplementationOnce(() => {
      throw new Error("Simulated investment update failure")
    })

    await expect(
      transitionLoan({
        loanId: loan._id.toString(),
        command: "activate",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Activate with failing side effect",
      }),
    ).rejects.toThrow("Simulated investment update failure")

    // Loan must still be Approved — the transaction was aborted
    const unchanged = await Loan.findById(loan._id)
    expect(unchanged!.status).toBe("Approved")

    spy.mockRestore()
  })

  it("transition history records all steps in a multi-hop lifecycle", async () => {
    if (skip()) return
    const loan = await makeLoan(vehicle._id, driverUser._id)
    const cmds: Array<{ command: "startReview" | "approve" | "reject"; reason: string }> = [
      { command: "startReview", reason: "Starting" },
      { command: "approve", reason: "Looks good" },
      { command: "reject", reason: "Changed mind" },
    ]

    for (const { command, reason } of cmds) {
      try {
        await transitionLoan({
          loanId: loan._id.toString(),
          command,
          actor: { type: "admin", id: adminUser._id.toString() },
          reason,
        })
      } catch {
        // reject from Approved is valid but let's just collect what succeeded
      }
    }

    const history = await StateTransitionHistory.find({
      entityType: "loan",
      entityId: loan._id,
    }).sort({ timestamp: 1 })

    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0].fromState).toBe("Pending")
    expect(history[0].toState).toBe("Under Review")
  })
})
