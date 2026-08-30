/**
 * lib/stellar/projections/rebuild.ts
 *
 * Ledger-range rebuild and projection comparison tooling.
 * Replays contract event logs to verify that genesis rebuilds produce identical
 * states as incremental projections.
 */

import {
  DecodedContractEvent,
  PoolProjectionState,
  DriverRepaymentProjectionState,
  PoolTransitionPayload,
  RepaymentTransitionPayload,
} from "@/types/contract-events"
import { reducePoolEvent, reduceRepaymentEvent } from "@/lib/stellar/projections/reducers"

export interface RebuildResult {
  poolProjections: Record<number, PoolProjectionState>
  driverProjections: Record<string, DriverRepaymentProjectionState>
  totalEventsProcessed: number
  duplicatesSkipped: number
  ledgerRange: { start: number; end: number }
}

export interface RebuildComparisonResult {
  isEquivalent: boolean
  mismatches: Array<{
    type: "pool" | "driver"
    key: string
    reason: string
    rebuiltState: unknown
    incrementalState: unknown
  }>
}

/**
 * Rebuilds state projections from an ordered stream of contract events.
 */
export function rebuildProjectionsFromEvents(
  events: DecodedContractEvent[],
  options?: { startLedger?: number; endLedger?: number },
): RebuildResult {
  const poolProjections: Record<number, PoolProjectionState> = {}
  const driverProjections: Record<string, DriverRepaymentProjectionState> = {}
  const processedEventIds = new Set<string>()

  let totalProcessed = 0
  let duplicatesSkipped = 0
  let minLedger = Infinity
  let maxLedger = -1

  // Filter by ledger range if specified
  const filteredEvents = events.filter((e) => {
    if (options?.startLedger !== undefined && e.ledger < options.startLedger) return false
    if (options?.endLedger !== undefined && e.ledger > options.endLedger) return false
    return true
  })

  // Ensure deterministic processing order: ledger ASC -> eventIndex ASC -> event.id ASC
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    if (a.ledger !== b.ledger) return a.ledger - b.ledger
    if (a.eventIndex !== b.eventIndex) return a.eventIndex - b.eventIndex
    return a.id.localeCompare(b.id)
  })

  for (const event of sortedEvents) {
    minLedger = Math.min(minLedger, event.ledger)
    maxLedger = Math.max(maxLedger, event.ledger)
    totalProcessed++

    if (event.topicCategory === "chainmove_pool_v1") {
      const poolEvent = event as DecodedContractEvent<PoolTransitionPayload>
      const poolId = poolEvent.payload.pool_id
      const current = poolProjections[poolId] ?? null

      const { state, isDuplicate } = reducePoolEvent(current, poolEvent, processedEventIds)
      if (isDuplicate) {
        duplicatesSkipped++
      } else {
        poolProjections[poolId] = state
      }
    } else if (event.topicCategory === "repayment_v1") {
      const repaymentEvent = event as DecodedContractEvent<RepaymentTransitionPayload>
      const driver = repaymentEvent.payload.driver
      const current = driverProjections[driver] ?? null

      const { state, isDuplicate } = reduceRepaymentEvent(current, repaymentEvent, processedEventIds)
      if (isDuplicate) {
        duplicatesSkipped++
      } else {
        driverProjections[driver] = state
      }
    }
  }

  return {
    poolProjections,
    driverProjections,
    totalEventsProcessed: totalProcessed,
    duplicatesSkipped,
    ledgerRange: {
      start: minLedger === Infinity ? 0 : minLedger,
      end: maxLedger === -1 ? 0 : maxLedger,
    },
  }
}

/**
 * Compares genesis rebuild projections with incremental projections.
 */
export function compareProjections(
  rebuilt: RebuildResult,
  incremental: {
    pools: Record<number, PoolProjectionState>
    drivers: Record<string, DriverRepaymentProjectionState>
  },
): RebuildComparisonResult {
  const mismatches: RebuildComparisonResult["mismatches"] = []

  // Compare Pool Projections
  const allPoolIds = new Set([
    ...Object.keys(rebuilt.poolProjections).map(Number),
    ...Object.keys(incremental.pools).map(Number),
  ])

  for (const poolId of allPoolIds) {
    const rPool = rebuilt.poolProjections[poolId]
    const iPool = incremental.pools[poolId]

    if (!rPool) {
      mismatches.push({
        type: "pool",
        key: String(poolId),
        reason: "Missing in rebuilt projections",
        rebuiltState: null,
        incrementalState: iPool,
      })
      continue
    }

    if (!iPool) {
      mismatches.push({
        type: "pool",
        key: String(poolId),
        reason: "Missing in incremental projections",
        rebuiltState: rPool,
        incrementalState: null,
      })
      continue
    }

    if (
      rPool.totalInvested !== iPool.totalInvested ||
      rPool.totalRepaid !== iPool.totalRepaid ||
      rPool.fundedUnits !== iPool.fundedUnits ||
      rPool.active !== iPool.active
    ) {
      mismatches.push({
        type: "pool",
        key: String(poolId),
        reason: "Totals or status mismatch between genesis rebuild and incremental projection",
        rebuiltState: rPool,
        incrementalState: iPool,
      })
    }
  }

  // Compare Driver Projections
  const allDrivers = new Set([
    ...Object.keys(rebuilt.driverProjections),
    ...Object.keys(incremental.drivers),
  ])

  for (const driver of allDrivers) {
    const rDriver = rebuilt.driverProjections[driver]
    const iDriver = incremental.drivers[driver]

    if (!rDriver) {
      mismatches.push({
        type: "driver",
        key: driver,
        reason: "Missing in rebuilt projections",
        rebuiltState: null,
        incrementalState: iDriver,
      })
      continue
    }

    if (!iDriver) {
      mismatches.push({
        type: "driver",
        key: driver,
        reason: "Missing in incremental projections",
        rebuiltState: rDriver,
        incrementalState: null,
      })
      continue
    }

    if (
      rDriver.totalOwed !== iDriver.totalOwed ||
      rDriver.totalRepaid !== iDriver.totalRepaid ||
      rDriver.active !== iDriver.active
    ) {
      mismatches.push({
        type: "driver",
        key: driver,
        reason: "Totals mismatch between genesis rebuild and incremental projection",
        rebuiltState: rDriver,
        incrementalState: iDriver,
      })
    }
  }

  return {
    isEquivalent: mismatches.length === 0,
    mismatches,
  }
}
