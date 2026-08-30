export type DistributionState =
  | "draft"
  | "calculated"
  | "approved"
  | "processing"
  | "paid"
  | "partially_failed"
  | "reversed"
  | "cancelled"

export interface SnapshotEntry {
  investorId: string
  units: number // integer ownership units (minor unit of ownership)
}

export interface Allocation {
  investorId: string
  amount: number // integer minor units to pay
  status: "pending" | "paid" | "failed" | "held"
  txId?: string
  failureReason?: string
}

export interface Distribution {
  id: string
  poolId: string
  snapshot: SnapshotEntry[]
  distributableAmount: number // integer minor units
  feeBps: number
  reserveBps: number
  allocations: Allocation[]
  feeAmount: number
  reserveAmount: number
  roundingRemainder: number
  state: DistributionState
  createdBy: string
  approvedBy?: string
  createdAt: Date
  approvedAt?: Date
  executedAt?: Date
}
