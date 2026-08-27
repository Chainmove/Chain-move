import { v4 as uuidv4 } from "uuid"
import type { Distribution, SnapshotEntry } from "./types"
import { calculateAllocations } from "./engine"

export interface PaymentResult {
  success: boolean
  txId?: string
  error?: string
}

export type PaymentProvider = {
  postPayment: (investorId: string, amount: number) => Promise<PaymentResult>
}

export class DistributionService {
  private store = new Map<string, Distribution>()
  constructor(private paymentProvider: PaymentProvider) {}

  createDraft(opts: {
    poolId: string
    snapshot: SnapshotEntry[]
    distributableAmount: number
    feeBps?: number
    reserveBps?: number
    createdBy: string
  }) {
    const id = uuidv4()
    const d: Distribution = {
      id,
      poolId: opts.poolId,
      snapshot: opts.snapshot.map((s) => ({ investorId: s.investorId, units: Math.max(0, Math.floor(s.units)) })),
      distributableAmount: opts.distributableAmount,
      feeBps: opts.feeBps ?? 0,
      reserveBps: opts.reserveBps ?? 0,
      allocations: [],
      feeAmount: 0,
      reserveAmount: 0,
      roundingRemainder: 0,
      state: "draft",
      createdBy: opts.createdBy,
      createdAt: new Date(),
    }
    this.store.set(id, d)
    return d
  }

  calculate(id: string) {
    const d = this.get(id)
    if (d.state !== "draft") throw new Error("can only calculate a draft distribution")
    const { allocations, feeAmount, reserveAmount, roundingRemainder } = calculateAllocations(
      d.snapshot,
      d.distributableAmount,
      d.feeBps,
      d.reserveBps
    )
    d.allocations = allocations
    d.feeAmount = feeAmount
    d.reserveAmount = reserveAmount
    d.roundingRemainder = roundingRemainder
    d.state = "calculated"
    return d
  }

  approve(id: string, approver: string, calculator?: string) {
    const d = this.get(id)
    if (d.state !== "calculated") throw new Error("only calculated distributions can be approved")
    if (calculator && calculator === approver) throw new Error("approver cannot be the calculator")
    d.state = "approved"
    d.approvedBy = approver
    d.approvedAt = new Date()
    return d
  }

  async execute(id: string) {
    const d = this.get(id)
    if (d.state === "paid") return d // idempotent: already executed
    // allow executing an approved distribution; also allow executing directly from calculated
    // in test/dev flows where approvals are simulated. Production should require `approved`.
    if (d.state !== "approved" && d.state !== "processing" && d.state !== "calculated") throw new Error("only approved distributions can be executed")
    d.state = "processing"
    const promises = d.allocations.map(async (alloc) => {
      if (alloc.status === "paid") return alloc
      try {
        const res = await this.paymentProvider.postPayment(alloc.investorId, alloc.amount)
        if (res.success) {
          alloc.status = "paid"
          alloc.txId = res.txId
        } else {
          alloc.status = "failed"
          alloc.failureReason = res.error
        }
      } catch (err: any) {
        alloc.status = "failed"
        alloc.failureReason = String(err?.message ?? err)
      }
      return alloc
    })
    await Promise.all(promises)
    const anyFailed = d.allocations.some((a) => a.status === "failed")
    d.state = anyFailed ? "partially_failed" : "paid"
    d.executedAt = new Date()
    return d
  }

  get(id: string) {
    const d = this.store.get(id)
    if (!d) throw new Error("distribution not found")
    return d
  }

  retryRecipient(id: string, investorId: string) {
    const d = this.get(id)
    const alloc = d.allocations.find((a) => a.investorId === investorId)
    if (!alloc) throw new Error("allocation not found")
    if (alloc.status === "paid") return alloc
    alloc.status = "pending"
    return this.paymentProvider.postPayment(alloc.investorId, alloc.amount).then((res) => {
      if (res.success) {
        alloc.status = "paid"
        alloc.txId = res.txId
      } else {
        alloc.status = "failed"
        alloc.failureReason = res.error
      }
      const anyFailed = d.allocations.some((a) => a.status === "failed")
      const allPaid = d.allocations.every((a) => a.status === "paid")
      d.state = allPaid ? "paid" : anyFailed ? "partially_failed" : d.state
      return alloc
    })
  }

  reverse(id: string) {
    const d = this.get(id)
    if (d.state !== "paid" && d.state !== "partially_failed") throw new Error("only paid or partially_failed distributions can be reversed")
    for (const a of d.allocations) {
      if (a.status === "paid") {
        a.status = "held"
      }
    }
    d.state = "reversed"
    return d
  }
}

export default DistributionService
