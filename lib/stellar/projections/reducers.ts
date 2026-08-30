/**
 * lib/stellar/projections/reducers.ts
 *
 * Idempotent state reducers for rebuilding financial projections from contract events.
 */

import {
  DecodedContractEvent,
  PoolProjectionState,
  DriverRepaymentProjectionState,
  PoolTransitionPayload,
  RepaymentTransitionPayload,
} from "@/types/contract-events"

/**
 * Idempotently reduces pool events into updated PoolProjectionState.
 */
export function reducePoolEvent(
  currentState: PoolProjectionState | null,
  event: DecodedContractEvent<PoolTransitionPayload>,
  processedEventIds: Set<string> = new Set(),
): { state: PoolProjectionState; isDuplicate: boolean } {
  // Idempotency check: if event was already processed, return current state unchanged
  if (processedEventIds.has(event.id)) {
    if (!currentState) {
      throw new Error(`Cannot skip duplicate event ${event.id} on empty state`)
    }
    return { state: currentState, isDuplicate: true }
  }

  const payload = event.payload
  const poolId = payload.pool_id

  let state: PoolProjectionState = currentState
    ? {
        ...currentState,
        investorPositions: { ...currentState.investorPositions },
      }
    : {
        id: poolId,
        asset: payload.asset,
        fundedUnits: 0,
        totalInvested: "0",
        totalRepaid: "0",
        active: true,
        lastLedgerProcessed: event.ledger,
        lastEventIdProcessed: event.id,
        investorPositions: {},
      }

  // Update ledger and last event metadata
  if (event.ledger > state.lastLedgerProcessed || (event.ledger === state.lastLedgerProcessed && event.id > state.lastEventIdProcessed)) {
    state.lastLedgerProcessed = event.ledger
    state.lastEventIdProcessed = event.id
  }

  const currentInvested = BigInt(state.totalInvested)
  const currentRepaid = BigInt(state.totalRepaid)
  const amount = BigInt(payload.amount)

  switch (event.eventType) {
    case "pool_created_v1": {
      state.asset = payload.asset
      state.active = true
      break
    }
    case "pool_funded_v1": {
      state.totalInvested = (currentInvested + amount).toString()
      state.fundedUnits = payload.post_funded_units ?? (state.fundedUnits + 1)
      
      const investor = payload.position_id
      const pos = state.investorPositions[investor] ?? {
        poolId,
        investor,
        units: 0,
        invested: "0",
        repaid: "0",
        refunded: "0",
      }

      state.investorPositions[investor] = {
        ...pos,
        invested: (BigInt(pos.invested) + amount).toString(),
        units: pos.units + (payload.post_funded_units > 0 ? 1 : 0),
      }
      break
    }
    case "pool_repaid_v1": {
      state.totalRepaid = (currentRepaid + amount).toString()
      
      const investor = payload.position_id
      if (investor && state.investorPositions[investor]) {
        const pos = state.investorPositions[investor]
        state.investorPositions[investor] = {
          ...pos,
          repaid: (BigInt(pos.repaid) + amount).toString(),
        }
      }
      break
    }
    case "pool_refund_v1": {
      state.totalInvested = (currentInvested - amount).toString()
      
      const investor = payload.position_id
      if (investor && state.investorPositions[investor]) {
        const pos = state.investorPositions[investor]
        state.investorPositions[investor] = {
          ...pos,
          invested: (BigInt(pos.invested) - amount).toString(),
          refunded: (BigInt(pos.refunded) + amount).toString(),
        }
      }
      break
    }
    case "pool_closed_v1": {
      state.active = false
      break
    }
  }

  processedEventIds.add(event.id)
  return { state, isDuplicate: false }
}

/**
 * Idempotently reduces repayment events into updated DriverRepaymentProjectionState.
 */
export function reduceRepaymentEvent(
  currentState: DriverRepaymentProjectionState | null,
  event: DecodedContractEvent<RepaymentTransitionPayload>,
  processedEventIds: Set<string> = new Set(),
): { state: DriverRepaymentProjectionState; isDuplicate: boolean } {
  if (processedEventIds.has(event.id)) {
    if (!currentState) {
      throw new Error(`Cannot skip duplicate event ${event.id} on empty state`)
    }
    return { state: currentState, isDuplicate: true }
  }

  const payload = event.payload

  let state: DriverRepaymentProjectionState = currentState
    ? { ...currentState }
    : {
        driver: payload.driver,
        poolOrVehicle: payload.pool_or_vehicle,
        totalOwed: "0",
        totalRepaid: "0",
        active: true,
        lastLedgerProcessed: event.ledger,
        lastEventIdProcessed: event.id,
      }

  if (event.ledger > state.lastLedgerProcessed || (event.ledger === state.lastLedgerProcessed && event.id > state.lastEventIdProcessed)) {
    state.lastLedgerProcessed = event.ledger
    state.lastEventIdProcessed = event.id
  }

  const currentRepaid = BigInt(state.totalRepaid)
  const amount = BigInt(payload.amount)

  switch (event.eventType) {
    case "repayment_init_v1": {
      state.active = true
      break
    }
    case "driver_assigned_v1": {
      state.driver = payload.driver
      state.poolOrVehicle = payload.pool_or_vehicle
      state.totalOwed = payload.post_total_owed || payload.amount
      state.active = true
      break
    }
    case "repayment_recorded_v1": {
      state.totalRepaid = (currentRepaid + amount).toString()
      break
    }
  }

  processedEventIds.add(event.id)
  return { state, isDuplicate: false }
}
