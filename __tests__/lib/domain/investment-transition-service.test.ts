// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import mongoose from "mongoose"

import Investment from "@/models/Investment"
import Vehicle from "@/models/Vehicle"
import User from "@/models/User"
import StateTransitionHistory from "@/models/StateTransitionHistory"
import {
  transitionInvestment,
  DomainTransitionError,
  DomainConcurrencyError,
} from "@/lib/domain/investment-transition-service"

const TEST_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

beforeAll(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 })
  } catch {
    console.warn("MongoDB not available — skipping investment service tests")
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

async function makeVehicle() {
  return Vehicle.create({
    name: "Invest Test Van",
    type: "van",
    year: 2023,
    price: 400000,
    roi: 14,
    status: "Available",
    fundingStatus: "Open",
    specifications: {
      engine: "2.0L",
      fuelType: "diesel",
      mileage: "28km/l",
      transmission: "manual",
      color: "grey",
      vin: `VIN-I-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  })
}

async function makeInvestor() {
  return User.create({
    name: "Invest Test Investor",
    email: `inv-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    role: "investor",
  })
}

async function makeAdmin() {
  return User.create({
    name: "Invest Test Admin",
    email: `admin-i-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    role: "admin",
  })
}

async function makeInvestment(vehicleId: unknown, investorId: unknown, overrides: Record<string, unknown> = {}) {
  return Investment.create({
    investorId,
    vehicleId,
    amount: 100000,
    monthlyReturn: 1167,
    status: "Funding",
    version: 0,
    ...overrides,
  })
}

describe("Investment transition service", () => {
  let adminUser: any
  let investor: any
  let vehicle: any

  beforeEach(async () => {
    if (skip()) return
    adminUser = await makeAdmin()
    investor = await makeInvestor()
    vehicle = await makeVehicle()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("activates a Funding investment", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    const result = await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "activate",
      actor: { type: "system" },
      reason: "Loan activated",
    })
    expect(result.previousStatus).toBe("Funding")
    expect(result.nextStatus).toBe("Active")
  })

  it("completes an Active investment", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id, { status: "Active" })
    const result = await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "complete",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Loan repaid in full",
    })
    expect(result.nextStatus).toBe("Completed")
  })

  it("records transition history", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "activate",
      actor: { type: "system" },
      reason: "History check",
    })
    const history = await StateTransitionHistory.findOne({
      entityType: "investment",
      entityId: inv._id,
    })
    expect(history).not.toBeNull()
    expect(history!.fromState).toBe("Funding")
    expect(history!.toState).toBe("Active")
  })

  it("is a no-op when already in target state", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id, { status: "Active" })
    const result = await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "activate",
      actor: { type: "admin", id: adminUser._id.toString() },
      reason: "Already active",
    })
    expect(result.previousStatus).toBe("Active")
    expect(result.nextStatus).toBe("Active")
  })

  // ── Forbidden transitions ──────────────────────────────────────────────────

  it("rejects completing from Funding (must activate first)", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    await expect(
      transitionInvestment({
        investmentId: inv._id.toString(),
        command: "complete",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Skipping Active",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("rejects any transition from Completed (terminal)", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id, { status: "Completed" })
    await expect(
      transitionInvestment({
        investmentId: inv._id.toString(),
        command: "activate",
        actor: { type: "admin", id: adminUser._id.toString() },
        reason: "Reactivating completed investment",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" })
  })

  it("rejects stale version (concurrent transition)", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "activate",
      actor: { type: "system" },
      reason: "First activation",
    })
    await expect(
      transitionInvestment({
        investmentId: inv._id.toString(),
        command: "complete",
        actor: { type: "system" },
        reason: "Concurrent complete",
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(DomainConcurrencyError)
  })

  it("requires a non-empty reason", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    await expect(
      transitionInvestment({
        investmentId: inv._id.toString(),
        command: "activate",
        actor: { type: "system" },
        reason: "  ",
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" })
  })

  it("transition history is queryable by correlationId", async () => {
    if (skip()) return
    const inv = await makeInvestment(vehicle._id, investor._id)
    const correlationId = `corr-${Date.now()}`
    await transitionInvestment({
      investmentId: inv._id.toString(),
      command: "activate",
      actor: { type: "system" },
      reason: "Correlation test",
      correlationId,
    })
    const history = await StateTransitionHistory.findOne({ correlationId })
    expect(history).not.toBeNull()
    expect(history!.entityType).toBe("investment")
  })
})
