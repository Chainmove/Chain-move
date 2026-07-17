import crypto from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import User from "@/models/User"

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUser: async (request: Request) => ({
    user: request.headers.get("x-test-user-id") ? await User.findById(request.headers.get("x-test-user-id")) : null,
    shouldRefreshSession: false,
  }),
  withSessionRefresh: async (response: Response) => response,
}))

import { POST as webhook } from "@/app/api/payments/webhook/route"
import { POST as invest } from "@/app/api/pools/[poolId]/invest/route"
import { GET as readKycDocument } from "@/app/api/kyc-documents/route"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import {
  contractFactory,
  driverDvaFactory,
  investorDvaFactory,
  poolFactory,
  roleFactory,
  transactionFactory,
} from "./harness/factories"
import { jsonRequest, responseJson } from "./harness/http"
import {
  expectGatewayReferenceCreditedOnce,
  expectPoolCapacityInvariant,
  expectWalletLedgerBalanced,
} from "./harness/invariants"

function webhookRequest(event: unknown, validSignature = true) {
  const body = JSON.stringify(event)
  const signature = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(body).digest("hex")
  return new Request("http://chainmove.test/api/payments/webhook", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-paystack-signature": validSignature ? signature : "invalid" },
  })
}

function dvaCharge(reference: string, accountNumber: string, amountNgn: number) {
  return {
    event: "charge.success",
    data: {
      reference,
      amount: amountNgn * 100,
      customer: { email: "payer@example.test" },
      metadata: {},
      authorization: {
        channel: "dedicated_nuban",
        receiver_bank_account_number: accountNumber,
        receiver_bank: "Integration Bank",
      },
    },
  }
}

describe("financial workflows through route handlers", () => {
  it("funds an investor wallet and invests from it while preserving ledger invariants", async () => {
    const [admin, investor] = await Promise.all([roleFactory.admin(), roleFactory.investor()])
    const pool = await poolFactory(admin._id.toString())
    await investorDvaFactory(investor._id.toString())

    const funding = await webhook(webhookRequest(dvaCharge("fund-and-invest", "1000000001", 40_000)))
    expect(funding.status).toBe(200)
    const investmentResponse = await invest(
      jsonRequest("/api/pools/" + pool._id + "/invest", {
        method: "POST",
        body: { amountNgn: 25_000, txRef: "investment-after-funding" },
        headers: { "x-test-user-id": investor._id.toString() },
      }),
      { params: Promise.resolve({ poolId: pool._id.toString() }) },
    )
    expect(investmentResponse.status).toBe(201)
    await expectWalletLedgerBalanced(investor._id.toString())
    await expectPoolCapacityInvariant(pool._id.toString())
  })

  it("credits duplicate Paystack webhooks at most once", async () => {
    const investor = await roleFactory.investor()
    await investorDvaFactory(investor._id.toString())
    const event = dvaCharge("duplicate-credit", "1000000001", 15_000)

    expect((await webhook(webhookRequest(event))).status).toBe(200)
    const duplicate = await responseJson<{ alreadyProcessed: boolean }>(await webhook(webhookRequest(event)))
    expect(duplicate.alreadyProcessed).toBe(true)
    await expectGatewayReferenceCreditedOnce("duplicate-credit")
    expect((await User.findById(investor._id))?.availableBalance).toBe(15_000)
  })

  it("rejects failed webhook authentication without changing financial state", async () => {
    const investor = await roleFactory.investor()
    await investorDvaFactory(investor._id.toString())
    const response = await webhook(webhookRequest(dvaCharge("bad-signature", "1000000001", 10_000), false))
    expect(response.status).toBe(401)
    expect(await Transaction.countDocuments()).toBe(0)
    expect((await User.findById(investor._id))?.availableBalance).toBe(0)
  })

  it("prevents a KYC-approved user from reading another user's document", async () => {
    const [owner, attacker] = await Promise.all([
      roleFactory.driver({ kycDocuments: ["https://blob.vercel-storage.com/owner-document.pdf"] }),
      roleFactory.investor({ kycStatus: "approved_stage2" }),
    ])
    const response = await readKycDocument(
      jsonRequest("/api/kyc-documents?ref=" + encodeURIComponent(owner.kycDocuments[0]), {
        headers: { "x-test-user-id": attacker._id.toString() },
      }),
    )
    expect(response?.status).toBe(403)
  })

  it("applies a driver dedicated-account repayment once", async () => {
    const [admin, driver] = await Promise.all([roleFactory.admin(), roleFactory.driver()])
    const pool = await poolFactory(admin._id.toString(), { status: "FUNDED", currentRaisedNgn: 100_000 })
    const contract = await contractFactory(driver._id.toString(), pool._id.toString())
    await driverDvaFactory(driver._id.toString(), contract._id.toString())
    const event = dvaCharge("driver-dva-repayment", "2000000001", 10_000)

    expect((await webhook(webhookRequest(event))).status).toBe(200)
    expect((await webhook(webhookRequest(event))).status).toBe(200)
    expect((await HirePurchaseContract.findById(contract._id))?.totalPaidNgn).toBe(10_000)
    expect(await DriverPayment.countDocuments({ paystackRef: "driver-dva-repayment", status: "CONFIRMED" })).toBe(1)
  })

  it("keeps concurrent investment attempts within pool capacity", async () => {
    const [admin, first, second] = await Promise.all([
      roleFactory.admin(),
      roleFactory.investor({ availableBalance: 100_000 }),
      roleFactory.investor({ availableBalance: 100_000 }),
    ])
    const pool = await poolFactory(admin._id.toString(), { targetAmountNgn: 100_000 })

    const attempt = async (userId: string, txRef: string) => {
      return invest(
        jsonRequest("/api/pools/" + pool._id + "/invest", {
          method: "POST",
          body: { amountNgn: 60_000, txRef },
          headers: { "x-test-user-id": userId },
        }),
        { params: Promise.resolve({ poolId: pool._id.toString() }) },
      )
    }
    const responses = await Promise.all([attempt(first._id.toString(), "capacity-a"), attempt(second._id.toString(), "capacity-b")])
    expect(responses.filter(response => response.status === 201)).toHaveLength(1)
    await expectPoolCapacityInvariant(pool._id.toString())
  })

  it("models cancellation refunds, payout distribution, and reconciliation as balanced ledger entries", async () => {
    const investor = await roleFactory.investor({ availableBalance: 20_000 })
    const admin = await roleFactory.admin()
    const pool = await poolFactory(admin._id.toString(), { status: "CLOSED" })
    await transactionFactory(investor._id.toString(), {
      type: "wallet_funding",
      amount: 20_000,
      gatewayReference: "refund-source",
    })
    await transactionFactory(investor._id.toString(), {
      type: "return",
      amount: 2_000,
      method: "system",
      relatedId: pool._id.toString(),
      description: "Fixture payout distribution",
    })
    const rows = await Transaction.find({ userId: investor._id }).lean()
    expect(rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(22_000)
    expect(await InvestmentPool.countDocuments({ _id: pool._id, status: "CLOSED" })).toBe(1)
    expect(await PoolInvestment.countDocuments({ poolId: pool._id, status: "CONFIRMED" })).toBe(0)
  })
})
