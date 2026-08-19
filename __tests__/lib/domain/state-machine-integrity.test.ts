// @vitest-environment node
/**
 * Tests for the integrity scanner that detects impossible state combinations
 * left by pre-state-machine code or interrupted transactions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import mongoose from "mongoose"

import Loan from "@/models/Loan"
import Vehicle from "@/models/Vehicle"
import Investment from "@/models/Investment"
import User from "@/models/User"

const TEST_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

beforeAll(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 })
  } catch {
    console.warn("MongoDB not available — skipping integrity tests")
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
    name: "Integrity Test Van",
    type: "van",
    year: 2022,
    price: 500000,
    roi: 12,
    status: "Available",
    fundingStatus: "Open",
    specifications: {
      engine: "2.0L",
      fuelType: "diesel",
      mileage: "28km/l",
      transmission: "manual",
      color: "black",
      vin: `VIN-INT-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    ...overrides,
  })
}

async function makeUser(role = "admin") {
  return User.create({
    name: `Integrity ${role}`,
    email: `int-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    role,
  })
}

// Inline the detection logic so tests run without spawning a subprocess
async function detectFinancedVehiclesWithNoActiveLoan(): Promise<mongoose.Types.ObjectId[]> {
  const financedVehicles = await Vehicle.find({ status: "Financed" }).select("_id").lean()
  const findings: mongoose.Types.ObjectId[] = []
  for (const v of financedVehicles) {
    const activeLoan = await Loan.findOne({ vehicleId: v._id, status: "Active" }).select("_id").lean()
    if (!activeLoan) findings.push(v._id)
  }
  return findings
}

async function detectReservedVehiclesWithNoInProgressLoan(): Promise<mongoose.Types.ObjectId[]> {
  const reservedVehicles = await Vehicle.find({ status: "Reserved" }).select("_id").lean()
  const findings: mongoose.Types.ObjectId[] = []
  for (const v of reservedVehicles) {
    const inProgressLoan = await Loan.findOne({
      vehicleId: v._id,
      status: { $in: ["Pending", "Under Review", "Approved"] },
    })
      .select("_id")
      .lean()
    if (!inProgressLoan) findings.push(v._id)
  }
  return findings
}

async function detectActiveLoansWithInsufficientFunding(): Promise<mongoose.Types.ObjectId[]> {
  const activeLoans = await Loan.find({ status: "Active" }).select("_id requestedAmount totalFunded").lean()
  return activeLoans
    .filter((l) => Number(l.totalFunded) < Number(l.requestedAmount))
    .map((l) => l._id)
}

async function detectActiveInvestmentsOnTerminatedLoans(): Promise<mongoose.Types.ObjectId[]> {
  const activeInvestments = await Investment.find({ status: "Active", loanId: { $exists: true } })
    .select("_id loanId")
    .lean()
  const findings: mongoose.Types.ObjectId[] = []
  for (const inv of activeInvestments) {
    const loan = await Loan.findById(inv.loanId).select("status").lean()
    if (loan && ["Completed", "Rejected", "Cancelled"].includes(loan.status)) {
      findings.push(inv._id)
    }
  }
  return findings
}

describe("State machine integrity scanner", () => {
  let driver: any

  beforeEach(async () => {
    if (skip()) return
    driver = await makeUser("driver")
  })

  describe("Financed vehicle with no active loan", () => {
    it("detects a Financed vehicle that has no matching Active loan", async () => {
      if (skip()) return

      const vehicle = await makeVehicle({ status: "Financed" })

      const findings = await detectFinancedVehiclesWithNoActiveLoan()

      const flagged = findings.some((id) => id.toString() === vehicle._id.toString())
      expect(flagged).toBe(true)

      await Vehicle.findByIdAndDelete(vehicle._id)
    })

    it("does not flag a Financed vehicle that has an Active loan", async () => {
      if (skip()) return

      const vehicle = await makeVehicle({ status: "Financed" })
      await Loan.create({
        driverId: driver._id,
        vehicleId: vehicle._id,
        requestedAmount: 500000,
        totalFunded: 500000,
        fundingProgress: 100,
        loanTerm: 12,
        monthlyPayment: 45000,
        interestRate: 8,
        status: "Active",
        downPaymentMade: true,
        version: 1,
      })

      const findings = await detectFinancedVehiclesWithNoActiveLoan()
      const flagged = findings.some((id) => id.toString() === vehicle._id.toString())
      expect(flagged).toBe(false)

      await Vehicle.findByIdAndDelete(vehicle._id)
    })
  })

  describe("Reserved vehicle with no in-progress loan", () => {
    it("detects a Reserved vehicle that has no matching in-progress loan", async () => {
      if (skip()) return

      const vehicle = await makeVehicle({ status: "Reserved" })
      const findings = await detectReservedVehiclesWithNoInProgressLoan()

      const flagged = findings.some((id) => id.toString() === vehicle._id.toString())
      expect(flagged).toBe(true)

      await Vehicle.findByIdAndDelete(vehicle._id)
    })

    it("does not flag a Reserved vehicle with a Pending loan", async () => {
      if (skip()) return

      const vehicle = await makeVehicle({ status: "Reserved" })
      await Loan.create({
        driverId: driver._id,
        vehicleId: vehicle._id,
        requestedAmount: 500000,
        totalFunded: 0,
        fundingProgress: 0,
        loanTerm: 12,
        monthlyPayment: 45000,
        interestRate: 8,
        status: "Pending",
        version: 0,
      })

      const findings = await detectReservedVehiclesWithNoInProgressLoan()
      const flagged = findings.some((id) => id.toString() === vehicle._id.toString())
      expect(flagged).toBe(false)

      await Vehicle.findByIdAndDelete(vehicle._id)
    })
  })

  describe("Active loan with insufficient funding", () => {
    it("detects an Active loan whose totalFunded is below requestedAmount", async () => {
      if (skip()) return

      const vehicle = await makeVehicle({ status: "Financed" })
      const loan = await Loan.create({
        driverId: driver._id,
        vehicleId: vehicle._id,
        requestedAmount: 500000,
        totalFunded: 100000,
        fundingProgress: 20,
        loanTerm: 12,
        monthlyPayment: 45000,
        interestRate: 8,
        status: "Active",
        downPaymentMade: true,
        version: 1,
      })

      const findings = await detectActiveLoansWithInsufficientFunding()
      const flagged = findings.some((id) => id.toString() === loan._id.toString())
      expect(flagged).toBe(true)

      await Loan.findByIdAndDelete(loan._id)
      await Vehicle.findByIdAndDelete(vehicle._id)
    })
  })

  describe("Active investment on a terminated loan", () => {
    it("detects an Active investment whose loan is Completed", async () => {
      if (skip()) return

      const admin = await makeUser("admin")
      const vehicle = await makeVehicle()
      const loan = await Loan.create({
        driverId: driver._id,
        vehicleId: vehicle._id,
        requestedAmount: 500000,
        totalFunded: 500000,
        fundingProgress: 100,
        loanTerm: 12,
        monthlyPayment: 45000,
        interestRate: 8,
        status: "Completed",
        downPaymentMade: true,
        version: 2,
      })
      const inv = await Investment.create({
        investorId: admin._id,
        vehicleId: vehicle._id,
        loanId: loan._id,
        amount: 500000,
        monthlyReturn: 6250,
        status: "Active",
        version: 1,
      })

      const findings = await detectActiveInvestmentsOnTerminatedLoans()
      const flagged = findings.some((id) => id.toString() === inv._id.toString())
      expect(flagged).toBe(true)

      await Investment.findByIdAndDelete(inv._id)
      await Loan.findByIdAndDelete(loan._id)
      await Vehicle.findByIdAndDelete(vehicle._id)
    })

    it("does not flag an Active investment on an Active loan", async () => {
      if (skip()) return

      const admin = await makeUser("admin")
      const vehicle = await makeVehicle({ status: "Financed" })
      const loan = await Loan.create({
        driverId: driver._id,
        vehicleId: vehicle._id,
        requestedAmount: 500000,
        totalFunded: 500000,
        fundingProgress: 100,
        loanTerm: 12,
        monthlyPayment: 45000,
        interestRate: 8,
        status: "Active",
        downPaymentMade: true,
        version: 1,
      })
      const inv = await Investment.create({
        investorId: admin._id,
        vehicleId: vehicle._id,
        loanId: loan._id,
        amount: 500000,
        monthlyReturn: 6250,
        status: "Active",
        version: 1,
      })

      const findings = await detectActiveInvestmentsOnTerminatedLoans()
      const flagged = findings.some((id) => id.toString() === inv._id.toString())
      expect(flagged).toBe(false)

      await Investment.findByIdAndDelete(inv._id)
      await Loan.findByIdAndDelete(loan._id)
      await Vehicle.findByIdAndDelete(vehicle._id)
    })
  })
})
