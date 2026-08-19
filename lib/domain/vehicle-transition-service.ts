import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import {
  isValidVehicleTransition,
  isVehicleActorAllowed,
  isTerminalVehicleStatus,
  isValidVehicleFundingTransition,
  type VehicleStatus,
  type VehicleFundingStatus,
  type VehicleActorType,
} from "@/lib/domain/vehicle-state-machine"
import { DomainTransitionError, DomainConcurrencyError, isWriteConflict } from "@/lib/domain/transition-error"
import Vehicle from "@/models/Vehicle"
import Loan from "@/models/Loan"
import StateTransitionHistory from "@/models/StateTransitionHistory"

export { DomainTransitionError, DomainConcurrencyError }

export type VehicleCommand =
  | "reserve"
  | "assignDriver"
  | "releaseReservation"
  | "finalize"
  | "enterMaintenance"
  | "exitMaintenance"
  | "retire"

const COMMAND_TARGET: Record<VehicleCommand, VehicleStatus> = {
  reserve: "Reserved",
  assignDriver: "Financed",
  releaseReservation: "Available",
  finalize: "Available",
  enterMaintenance: "Maintenance",
  exitMaintenance: "Available",
  retire: "Retired",
}

export interface VehicleTransitionInput {
  vehicleId: string
  command: VehicleCommand
  actor: { type: VehicleActorType; id?: string }
  reason: string
  expectedVersion?: number
  driverId?: string
  correlationId?: string
  metadata?: Record<string, unknown>
  session?: ClientSession
}

export interface VehicleTransitionResult {
  vehicle: any
  previousStatus: VehicleStatus
  nextStatus: VehicleStatus
}

export interface VehicleFundingTransitionInput {
  vehicleId: string
  targetFundingStatus: VehicleFundingStatus
  actor: { type: VehicleActorType; id?: string }
  reason: string
  session?: ClientSession
}

function toObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new DomainTransitionError("INVALID_INPUT", `Invalid ${label}.`)
  }
  return new mongoose.Types.ObjectId(value)
}

async function runInSession<T>(
  existing: ClientSession | undefined,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (existing) return fn(existing)

  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const result = await fn(session)
    await session.commitTransaction()
    return result
  } catch (err) {
    await session.abortTransaction().catch(() => undefined)
    throw err
  } finally {
    session.endSession()
  }
}

/**
 * The single authoritative entry point for vehicle operational status changes.
 */
export async function transitionVehicle(
  input: VehicleTransitionInput,
): Promise<VehicleTransitionResult> {
  await dbConnect()

  if (!input.reason?.trim()) {
    throw new DomainTransitionError("REASON_REQUIRED", "A reason is required for every vehicle state transition.")
  }

  const vehicleObjectId = toObjectId(input.vehicleId, "vehicle id")
  const targetStatus = COMMAND_TARGET[input.command]

  try {
    return await runInSession(input.session, async (session) => {
      const vehicle = await Vehicle.findById(vehicleObjectId).session(session)
      if (!vehicle) throw new DomainTransitionError("NOT_FOUND", "Vehicle not found.")

      const from = vehicle.status as VehicleStatus
      const to = targetStatus

      if (from === to) {
        return { vehicle, previousStatus: from, nextStatus: to }
      }

      if (isTerminalVehicleStatus(from)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Vehicle is retired and cannot be transitioned.`,
        )
      }

      if (!isValidVehicleTransition(from, to)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Cannot transition vehicle from '${from}' to '${to}'.`,
        )
      }

      if (!isVehicleActorAllowed(to, input.actor.type)) {
        throw new DomainTransitionError(
          "FORBIDDEN_ACTOR",
          `Actor type '${input.actor.type}' is not permitted to transition a vehicle to '${to}'.`,
        )
      }

      const setFields: Record<string, unknown> = { status: to }
      const unsetFields: Record<string, unknown> = {}

      if (to === "Reserved" && input.driverId) {
        setFields.driverId = toObjectId(input.driverId, "driver id")
      }

      if (to === "Financed") {
        if (!input.driverId) {
          throw new DomainTransitionError(
            "PRECONDITION_FAILED",
            "A driverId is required to finalize vehicle assignment.",
          )
        }
        setFields.driverId = toObjectId(input.driverId, "driver id")
        setFields.fundingStatus = "Active"
      }

      if (to === "Available") {
        unsetFields.driverId = 1
        // Only reset fundingStatus if vehicle is leaving Financed/Reserved back to Available
        if (from === "Financed") {
          setFields.fundingStatus = "Open"
        }
      }

      if (to === "Maintenance") {
        // Guard: cannot enter maintenance while carrying an active loan
        const activeLoan = await Loan.findOne({
          vehicleId: vehicle._id,
          status: "Active",
        })
          .select("_id")
          .session(session)
        if (activeLoan) {
          throw new DomainTransitionError(
            "PRECONDITION_FAILED",
            "Vehicle has an active loan and cannot enter maintenance without first completing or transferring the loan.",
          )
        }
      }

      const expectedVersion = input.expectedVersion ?? (vehicle.version ?? 0)
      const versionCondition =
        expectedVersion === 0
          ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
          : { version: expectedVersion }

      const updateOp: Record<string, unknown> = {
        $set: setFields,
        $inc: { version: 1 },
      }
      if (Object.keys(unsetFields).length > 0) updateOp.$unset = unsetFields

      const updated = await Vehicle.findOneAndUpdate(
        { _id: vehicle._id, ...versionCondition },
        updateOp,
        { session, new: true },
      )

      if (!updated) throw new DomainConcurrencyError("vehicle")

      await StateTransitionHistory.create(
        [
          {
            entityType: "vehicle",
            entityId: vehicle._id,
            fromState: from,
            toState: to,
            actorType: input.actor.type,
            actorId: input.actor.id ? toObjectId(input.actor.id, "actor id") : undefined,
            reason: input.reason.trim(),
            correlationId: input.correlationId,
            metadata: input.metadata,
            timestamp: new Date(),
          },
        ],
        { session },
      )

      await logAuditEvent({
        actor: input.actor.id
          ? { _id: { toString: () => input.actor.id as string }, role: input.actor.type }
          : null,
        action: `vehicle.transition.${to.toLowerCase()}`,
        targetType: "vehicle",
        targetId: vehicle._id.toString(),
        metadata: {
          fromState: from,
          toState: to,
          command: input.command,
          reason: input.reason,
          actorType: input.actor.type,
          correlationId: input.correlationId,
        },
      })

      return { vehicle: updated, previousStatus: from, nextStatus: to }
    })
  } catch (err) {
    if (isWriteConflict(err)) throw new DomainConcurrencyError("vehicle")
    throw err
  }
}

/**
 * Transition vehicle funding status independently of operational status.
 * This is driven by investment totals reaching the vehicle price threshold.
 */
export async function transitionVehicleFunding(
  input: VehicleFundingTransitionInput,
): Promise<{ vehicle: any; previousFundingStatus: VehicleFundingStatus; nextFundingStatus: VehicleFundingStatus }> {
  await dbConnect()

  const vehicleObjectId = toObjectId(input.vehicleId, "vehicle id")

  return runInSession(input.session, async (session) => {
    const vehicle = await Vehicle.findById(vehicleObjectId).session(session)
    if (!vehicle) throw new DomainTransitionError("NOT_FOUND", "Vehicle not found.")

    const from = vehicle.fundingStatus as VehicleFundingStatus
    const to = input.targetFundingStatus

    if (from === to) return { vehicle, previousFundingStatus: from, nextFundingStatus: to }

    if (!isValidVehicleFundingTransition(from, to)) {
      throw new DomainTransitionError(
        "INVALID_TRANSITION",
        `Cannot transition vehicle funding from '${from}' to '${to}'.`,
      )
    }

    const updated = await Vehicle.findByIdAndUpdate(
      vehicle._id,
      { $set: { fundingStatus: to }, $inc: { version: 1 } },
      { session, new: true },
    )

    if (!updated) throw new DomainConcurrencyError("vehicle")

    await logAuditEvent({
      actor: input.actor.id
        ? { _id: { toString: () => input.actor.id as string }, role: input.actor.type }
        : null,
      action: `vehicle.funding.transition.${to.toLowerCase()}`,
      targetType: "vehicle",
      targetId: vehicle._id.toString(),
      metadata: { fromFundingStatus: from, toFundingStatus: to, reason: input.reason },
    })

    return { vehicle: updated, previousFundingStatus: from, nextFundingStatus: to }
  })
}
