/**
 * types/contract-events.ts
 *
 * Types for versioned Soroban contract events emitted by ChainMove contracts:
 * - chainmove-pool (v1): pool_created_v1, pool_funded_v1, pool_repaid_v1, pool_refund_v1, pool_closed_v1
 * - repayment (v1): repayment_init_v1, driver_assigned_v1, repayment_recorded_v1
 */

export const CURRENT_EVENT_SCHEMA_VERSION = 1

export type PoolEventType =
  | "pool_created_v1"
  | "pool_funded_v1"
  | "pool_repaid_v1"
  | "pool_refund_v1"
  | "pool_closed_v1"

export type RepaymentEventType =
  | "repayment_init_v1"
  | "driver_assigned_v1"
  | "repayment_recorded_v1"

export type ContractEventType = PoolEventType | RepaymentEventType

export interface PoolTransitionPayload {
  version: number
  asset: string
  amount: string // integer minor unit represented as string/bigint
  pool_id: number
  position_id: string
  actor: string
  reference: string
  post_funded_units: number
  post_total_invested: string
  post_total_repaid: string
}

export interface RepaymentTransitionPayload {
  version: number
  driver: string
  pool_or_vehicle: string
  actor: string
  amount: string
  post_total_owed: string
  post_total_repaid: string
}

export interface DecodedContractEvent<T = PoolTransitionPayload | RepaymentTransitionPayload> {
  id: string
  contractId: string
  ledger: number
  eventIndex: number
  transactionHash: string
  topicCategory: "chainmove_pool_v1" | "repayment_v1"
  eventType: ContractEventType
  schemaVersion: number
  timestamp?: string
  payload: T
}

export interface PoolProjectionState {
  id: number
  asset: string
  fundedUnits: number
  totalInvested: string
  totalRepaid: string
  active: boolean
  lastLedgerProcessed: number
  lastEventIdProcessed: string
  investorPositions: Record<string, InvestorPositionProjection>
}

export interface InvestorPositionProjection {
  poolId: number
  investor: string
  units: number
  invested: string
  repaid: string
  refunded: string
}

export interface DriverRepaymentProjectionState {
  driver: string
  poolOrVehicle: string
  totalOwed: string
  totalRepaid: string
  active: boolean
  lastLedgerProcessed: number
  lastEventIdProcessed: string
}
