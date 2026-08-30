import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import {
  isValidLoanTransition,
  isLoanActorAllowed,
  isTerminalLoanState,
  type LoanStatus,
  type LoanActorType,
} from "@/lib/domain/loan-state-machine"
import { DomainTransitionError, DomainConcurrencyError, isWriteConflict } from "@/lib/domain/transition-error"
import Loan from "@/models/Loan"
import Vehicle from "@/models/Vehicle"
import Investment from "@/models/Investment"
import StateTransitionHistory from "@/models/StateTransitionHistory"

export { DomainTransitionError, DomainConcurrencyError }

export type LoanCommand =
  | "startReview"
  | "approve"
  | "reject"
  | "activate"
  | "complete"
  | "cancel"

const COMMAND_TARGET: Record<LoanCommand, LoanStatus> = {
  startReview: "Under Review",
  approve: "Approved",
  reject: "Rejected",
  activate: "Active",
  complete: "Completed",
  cancel: "Cancelled",
}

export interface LoanTransitionInput {
  loanId: string
  command: LoanCommand
  actor: { type: LoanActorType; id?: string }
  reason: string
  expectedVersion?: number
  adminNotes?: string
  correlationId?: string
  metadata?: Record<string, unknown>
  session?: ClientSession
}

export interface LoanTransitionResult {
  loan: any
  previousStatus: LoanStatus
  nextStatus: LoanStatus
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
 * The single authoritative entry point for loan status changes.
 * Every status mutation must go through this function — direct field writes
 * on the Loan document are not supported outside of this service.
 */
export async function transitionLoan(input: LoanTransitionInput): Promise<LoanTransitionResult> {
  await dbConnect()

  if (!input.reason?.trim()) {
    throw new DomainTransitionError("REASON_REQUIRED", "A reason is required for every loan state transition.")
  }

  const loanObjectId = toObjectId(input.loanId, "loan id")
  const targetStatus = COMMAND_TARGET[input.command]

  try {
    return await runInSession(input.session, async (session) => {
      const loan = await Loan.findById(loanObjectId).session(session)
      if (!loan) throw new DomainTransitionError("NOT_FOUND", "Loan not found.")

      const from = loan.status as LoanStatus
      const to = targetStatus

      if (from === to) {
        return { loan, previousStatus: from, nextStatus: to }
      }

      if (isTerminalLoanState(from)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Loan is in a terminal state '${from}' and cannot be transitioned.`,
        )
      }

      if (!isValidLoanTransition(from, to)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Cannot transition loan from '${from}' to '${to}'.`,
        )
      }

      if (!isLoanActorAllowed(to, from, input.actor.type)) {
        throw new DomainTransitionError(
          "FORBIDDEN_ACTOR",
          `Actor type '${input.actor.type}' is not permitted to transition a loan from '${from}' to '${to}'.`,
        )
      }

      const setFields: Record<string, unknown> = { status: to }
      const sideEffects: Array<() => Promise<void>> = []

      if (to === "Under Review") {
        setFields.reviewedDate = new Date()
      }

      if (to === "Approved") {
        setFields.approvedDate = new Date()
        if (input.adminNotes) setFields.adminNotes = input.adminNotes
      }

      if (to === "Rejected") {
        if (input.adminNotes) setFields.adminNotes = input.adminNotes
        // Release vehicle back to Available when rejecting
        sideEffects.push(async () => {
          await Vehicle.findOneAndUpdate(
            { _id: loan.vehicleId },
            { $set: { status: "Available" }, $unset: { driverId: 1 } },
            { session },
          )
        })
      }

      if (to === "Active") {
        // Precondition: loan must be fully funded
        if (Number(loan.totalFunded || 0) < Number(loan.requestedAmount || 0)) {
          throw new DomainTransitionError(
            "PRECONDITION_FAILED",
            `Loan cannot be activated: funding is ${loan.totalFunded} of ${loan.requestedAmount} required.`,
          )
        }
        // Precondition: down payment must be made
        if (!loan.downPaymentMade) {
          throw new DomainTransitionError(
            "PRECONDITION_FAILED",
            "Loan cannot be activated: down payment has not been recorded.",
          )
        }
        sideEffects.push(async () => {
          await Vehicle.findOneAndUpdate(
            { _id: loan.vehicleId },
            { $set: { status: "Financed", fundingStatus: "Active", driverId: loan.driverId } },
            { session },
          )
          // Move all investments for this vehicle from Funding to Active
          await Investment.updateMany(
            { vehicleId: loan.vehicleId, status: "Funding" },
            { $set: { status: "Active" }, $inc: { version: 1 } },
            { session },
          )
        })
      }

      if (to === "Completed") {
        sideEffects.push(async () => {
          await Vehicle.findOneAndUpdate(
            { _id: loan.vehicleId },
            { $set: { status: "Available", fundingStatus: "Open" }, $unset: { driverId: 1 } },
            { session },
          )
          // Complete all active investments tied to this loan's vehicle
          await Investment.updateMany(
            {
              $or: [{ loanId: loan._id }, { vehicleId: loan.vehicleId }],
              status: "Active",
            },
            { $set: { status: "Completed" }, $inc: { version: 1 } },
            { session },
          )
        })
      }

      if (to === "Cancelled") {
        sideEffects.push(async () => {
          await Vehicle.findOneAndUpdate(
            { _id: loan.vehicleId },
            { $set: { status: "Available" }, $unset: { driverId: 1 } },
            { session },
          )
        })
      }

      const expectedVersion = input.expectedVersion ?? (loan.version ?? 0)
      const versionCondition =
        expectedVersion === 0
          ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
          : { version: expectedVersion }

      const updated = await Loan.findOneAndUpdate(
        { _id: loan._id, ...versionCondition },
        { $set: setFields, $inc: { version: 1 } },
        { session, new: true },
      )

      if (!updated) throw new DomainConcurrencyError("loan")

      for (const effect of sideEffects) await effect()

      await StateTransitionHistory.create(
        [
          {
            entityType: "loan",
            entityId: loan._id,
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
        action: `loan.transition.${to.toLowerCase().replace(/\s+/g, "_")}`,
        targetType: "loan",
        targetId: loan._id.toString(),
        metadata: {
          fromState: from,
          toState: to,
          command: input.command,
          reason: input.reason,
          actorType: input.actor.type,
          correlationId: input.correlationId,
        },
      })

      return { loan: updated, previousStatus: from, nextStatus: to }
    })
  } catch (err) {
    if (isWriteConflict(err)) throw new DomainConcurrencyError("loan")
    throw err
  }
}
