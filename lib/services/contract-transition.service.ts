import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { isActorAllowedForTransition, isValidTransition } from "@/lib/contracts/state-machine"
import { isKycApproved } from "@/lib/authorization/policy"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRepaymentSchedule } from "@/lib/contracts/repayment-schedule"
import HirePurchaseContract, {
  HirePurchaseContractStatus,
  HirePurchaseContractTransitionActor,
} from "@/models/HirePurchaseContract"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"

export class ContractTransitionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ContractTransitionError"
    this.code = code
  }
}

export class ContractConcurrencyError extends ContractTransitionError {
  constructor(message = "This contract was modified by another transition. Please retry.") {
    super("CONCURRENCY_CONFLICT", message)
    this.name = "ContractConcurrencyError"
  }
}

export interface RestructureTerms {
  totalPayableNgn?: number
  weeklyPaymentNgn?: number
  durationWeeks?: number
  startDate?: Date | string
}

export interface TransitionContractInput {
  contractId: string
  targetState: HirePurchaseContractStatus
  actor: { type: HirePurchaseContractTransitionActor; userId?: string }
  reason: string
  expectedVersion?: number
  vehicleId?: string
  restructure?: RestructureTerms
  metadata?: Record<string, unknown>
  session?: ClientSession
}

export interface TransitionContractResult {
  contract: any
  previousState: HirePurchaseContractStatus
}

function toObjectId(value: string, fieldLabel: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ContractTransitionError("INVALID_INPUT", `Invalid ${fieldLabel}.`)
  }
  return new mongoose.Types.ObjectId(value)
}

function isWriteConflict(error: unknown) {
  if (!error || typeof error !== "object") return false
  const err = error as { code?: number; codeName?: string; errorLabels?: string[] }
  return err.code === 112 || err.codeName === "WriteConflict" || (err.errorLabels || []).includes("TransientTransactionError")
}

async function runInSession<T>(
  existingSession: ClientSession | undefined,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (existingSession) {
    return fn(existingSession)
  }

  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const result = await fn(session)
    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction().catch(() => undefined)
    throw error
  } finally {
    session.endSession()
  }
}

/**
 * The single authoritative entry point for hire-purchase contract status
 * changes. Validates the transition, the acting party, and any
 * transition-specific preconditions; keeps vehicle status in sync; appends an
 * immutable timeline entry; writes an audit event; and enforces optimistic
 * concurrency via the contract's `version` field. Direct `contract.status`
 * mutation elsewhere is not supported — every status change must go through
 * this function.
 */
export async function transitionHirePurchaseContract(
  input: TransitionContractInput,
): Promise<TransitionContractResult> {
  await dbConnect()

  if (!input.reason?.trim()) {
    throw new ContractTransitionError("REASON_REQUIRED", "A reason is required for every contract state transition.")
  }

  const contractObjectId = toObjectId(input.contractId, "contract id")

  try {
    return await runInSession(input.session, async (session) => {
      const contract = await HirePurchaseContract.findById(contractObjectId).session(session)
      if (!contract) {
        throw new ContractTransitionError("NOT_FOUND", "Hire-purchase contract not found.")
      }

      const previousState = contract.status as HirePurchaseContractStatus
      const targetState = input.targetState

      if (previousState === targetState) {
        return { contract, previousState }
      }

      if (!isValidTransition(previousState, targetState)) {
        throw new ContractTransitionError(
          "INVALID_TRANSITION",
          `Cannot transition contract from '${previousState}' to '${targetState}'.`,
        )
      }

      if (!isActorAllowedForTransition(targetState, previousState, input.actor.type)) {
        throw new ContractTransitionError(
          "FORBIDDEN_ACTOR",
          `Actor type '${input.actor.type}' is not permitted to transition a contract from '${previousState}' to '${targetState}'.`,
        )
      }

      const setFields: Record<string, unknown> = { status: targetState }
      const vehicleSideEffects: Array<() => Promise<void>> = []

      if (targetState === "VEHICLE_ASSIGNED") {
        if (!input.vehicleId) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "A vehicleId is required to assign a vehicle.")
        }
        const vehicleObjectId = toObjectId(input.vehicleId, "vehicle id")
        const vehicle = await Vehicle.findById(vehicleObjectId).session(session)
        if (!vehicle) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "Assigned vehicle was not found.")
        }
        if (vehicle.status !== "Available") {
          throw new ContractTransitionError(
            "PRECONDITION_FAILED",
            `Vehicle is not available for assignment (status: ${vehicle.status}).`,
          )
        }
        setFields.vehicleId = vehicleObjectId
        vehicleSideEffects.push(async () => {
          await Vehicle.updateOne({ _id: vehicleObjectId }, { $set: { status: "Reserved" } }, { session })
        })
      }

      if (targetState === "ACTIVE" && previousState === "VEHICLE_ASSIGNED") {
        const driver = await User.findById(contract.driverUserId).session(session)
        if (!isKycApproved(driver)) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "Driver KYC must be fully approved before activation.")
        }
        if (!contract.vehicleId) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "A vehicle must be assigned before activation.")
        }
        if (!(contract.totalPayableNgn > 0 && contract.durationWeeks > 0 && contract.weeklyPaymentNgn > 0 && contract.startDate)) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "Contract terms are incomplete or invalid.")
        }
        const schedule = buildRepaymentSchedule(contract as any)
        if (schedule.length === 0) {
          throw new ContractTransitionError(
            "PRECONDITION_FAILED",
            "A repayment schedule could not be generated for these contract terms.",
          )
        }
        vehicleSideEffects.push(async () => {
          await Vehicle.updateOne(
            { _id: contract.vehicleId },
            { $set: { status: "Financed", driverId: contract.driverUserId } },
            { session },
          )
        })
      }

      if (targetState === "COMPLETED") {
        if (Number(contract.totalPaidNgn || 0) < Number(contract.totalPayableNgn || 0)) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "The payable balance is not yet fully settled.")
        }
      }

      if (targetState === "RESTRUCTURED") {
        const restructure = input.restructure
        const hasUpdatedTerm =
          restructure &&
          (restructure.totalPayableNgn !== undefined ||
            restructure.weeklyPaymentNgn !== undefined ||
            restructure.durationWeeks !== undefined ||
            restructure.startDate !== undefined)
        if (!hasUpdatedTerm) {
          throw new ContractTransitionError("PRECONDITION_FAILED", "Restructuring requires at least one updated term.")
        }
        if (restructure!.totalPayableNgn !== undefined) setFields.totalPayableNgn = restructure!.totalPayableNgn
        if (restructure!.weeklyPaymentNgn !== undefined) setFields.weeklyPaymentNgn = restructure!.weeklyPaymentNgn
        if (restructure!.durationWeeks !== undefined) setFields.durationWeeks = restructure!.durationWeeks
        if (restructure!.startDate !== undefined) setFields.startDate = new Date(restructure!.startDate)
      }

      // Legacy contracts created before vehicleId existed have no vehicle to
      // release on repossession; flag it rather than silently doing nothing.
      const vehicleSyncSkipped = targetState === "REPOSSESSED" && !contract.vehicleId

      if (targetState === "REPOSSESSED" && contract.vehicleId) {
        vehicleSideEffects.push(async () => {
          await Vehicle.updateOne(
            { _id: contract.vehicleId },
            { $set: { status: "Reserved" }, $unset: { driverId: 1 } },
            { session },
          )
        })
      }

      const timelineEntry = {
        fromState: previousState,
        toState: targetState,
        actorType: input.actor.type,
        actorUserId: input.actor.userId ? toObjectId(input.actor.userId, "actor user id") : undefined,
        reason: input.reason,
        metadata: {
          ...(input.metadata || {}),
          ...(vehicleSyncSkipped ? { vehicleSyncSkipped: true } : {}),
        },
        timestamp: new Date(),
      }

      const expectedVersion = input.expectedVersion ?? contract.version ?? 0

      // A document written before the `version` field existed (pre-migration
      // legacy data) has no `version` key at all in MongoDB, so an equality
      // filter of `{ version: 0 }` would never match it even though Mongoose
      // hydrates the in-memory `contract.version` as 0 via the schema default.
      // Treat "missing" and "0" as the same starting point so legacy contracts
      // remain transitionable even before the backfill migration has run.
      const versionCondition =
        expectedVersion === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version: expectedVersion }

      const updated = await HirePurchaseContract.findOneAndUpdate(
        { _id: contract._id, ...versionCondition },
        {
          $set: setFields,
          $inc: { version: 1 },
          $push: { timeline: timelineEntry },
        },
        { session, new: true },
      )

      if (!updated) {
        throw new ContractConcurrencyError()
      }

      for (const effect of vehicleSideEffects) {
        await effect()
      }

      await logAuditEvent({
        actor: input.actor.userId ? { _id: { toString: () => input.actor.userId as string }, role: input.actor.type } : null,
        action: `CONTRACT_TRANSITION_${targetState}`,
        targetType: "HirePurchaseContract",
        targetId: contract._id.toString(),
        metadata: {
          fromState: previousState,
          toState: targetState,
          reason: input.reason,
          actorType: input.actor.type,
        },
      })

      return { contract: updated, previousState }
    })
  } catch (error) {
    if (isWriteConflict(error)) {
      throw new ContractConcurrencyError()
    }
    throw error
  }
}
