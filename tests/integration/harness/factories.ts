import mongoose from "mongoose"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import PoolInvestment from "@/models/PoolInvestment"
import ProcessedGatewayEvent from "@/models/ProcessedGatewayEvent"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"

let sequence = 0
const next = () => ++sequence

export async function userFactory(overrides: Record<string, unknown> = {}) {
  const id = next()
  return User.create({
    name: "Fixture User " + id,
    email: "fixture-" + id + "@example.test",
    role: "investor",
    availableBalance: 0,
    kycStatus: "approved_stage2",
    ...overrides,
  })
}

export const roleFactory = {
  investor: (overrides = {}) => userFactory({ role: "investor", ...overrides }),
  driver: (overrides = {}) => userFactory({ role: "driver", ...overrides }),
  admin: (overrides = {}) => userFactory({ role: "admin", ...overrides }),
}

export async function poolFactory(createdBy: string, overrides: Record<string, unknown> = {}) {
  return InvestmentPool.create({
    assetType: "KEKE",
    assetPriceNgn: 100_000,
    targetAmountNgn: 100_000,
    minContributionNgn: 5_000,
    currentRaisedNgn: 0,
    investorCount: 0,
    status: "OPEN",
    createdBy,
    ...overrides,
  })
}

export async function vehicleFactory(overrides: Record<string, unknown> = {}) {
  const id = next()
  return Vehicle.create({
    name: "Fixture Vehicle " + id,
    identifier: "VEH-" + id,
    type: "KEKE",
    year: 2026,
    price: 100_000,
    roi: 12,
    specifications: { vin: "VIN-FIXTURE-" + id },
    ...overrides,
  })
}

export async function contractFactory(driverUserId: string, poolId: string, overrides: Record<string, unknown> = {}) {
  return HirePurchaseContract.create({
    driverUserId,
    poolId,
    assetType: "KEKE",
    vehicleDisplayName: "Fixture KEKE",
    principalNgn: 100_000,
    depositNgn: 10_000,
    totalPayableNgn: 120_000,
    durationWeeks: 12,
    weeklyPaymentNgn: 10_000,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    nextDueDate: new Date("2026-01-08T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  })
}

export async function investmentFactory(userId: string, poolId: string, overrides: Record<string, unknown> = {}) {
  return PoolInvestment.create({
    userId,
    poolId,
    amountNgn: 10_000,
    ownershipUnits: 100_000,
    ownershipBps: 1_000,
    txRef: "fixture-investment-" + next(),
    status: "CONFIRMED",
    ...overrides,
  })
}

export async function legacyInvestmentFactory(investorId: string, vehicleId: string, overrides: Record<string, unknown> = {}) {
  return Investment.create({ investorId, vehicleId, amount: 10_000, monthlyReturn: 1_000, ...overrides })
}

export async function transactionFactory(userId: string, overrides: Record<string, unknown> = {}) {
  return Transaction.create({
    userId,
    userType: "investor",
    type: "wallet_funding",
    amount: 10_000,
    status: "Completed",
    description: "Fixture transaction",
    ...overrides,
  })
}

export function scheduleFactory(overrides: Record<string, unknown> = {}) {
  return {
    dueDate: new Date("2026-01-08T00:00:00.000Z"),
    amountNgn: 10_000,
    status: "DUE",
    ...overrides,
  }
}

export async function providerEventFactory(reference: string, overrides: Record<string, unknown> = {}) {
  return ProcessedGatewayEvent.create({
    _id: reference,
    paymentType: "wallet_funding",
    processedVia: "webhook",
    ...overrides,
  })
}

export async function investorDvaFactory(investorUserId: string, accountNumber = "1000000001") {
  return InvestorVirtualAccount.create({
    investorUserId,
    provider: "PAYSTACK",
    status: "ACTIVE",
    accountNumber,
    dedicatedAccountId: next(),
  })
}

export async function driverDvaFactory(driverUserId: string, contractId: string, accountNumber = "2000000001") {
  return DriverVirtualAccount.create({
    driverUserId,
    contractId,
    provider: "PAYSTACK",
    status: "ACTIVE",
    accountNumber,
    dedicatedAccountId: next(),
  })
}

export function objectId() {
  return new mongoose.Types.ObjectId()
}
