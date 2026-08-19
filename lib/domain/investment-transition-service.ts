import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import {
  isValidInvestmentTransition,
  isInvestmentActorAllowed,
  isTerminalInvestmentState,
  type InvestmentStatus,
  type InvestmentActorType,
} from "@/lib/domain/investment-state-machine"
import { DomainTransitionError, DomainConcurrencyError, isWriteConflict } from "@/lib/domain/transition-error"
import Investment from "@/models/Investment"
import StateTransitionHistory from "@/models/StateTransitionHistory"

export { DomainTransitionError, DomainConcurrencyError }

export type InvestmentCommand = "activate" | "complete"

const COMMAND_TARGET: Record<InvestmentCommand, InvestmentStatus> = {
  activate: "Active",
  complete: "Completed",
}

export interface InvestmentTransitionInput {
  investmentId: string
  command: InvestmentCommand
  actor: { type: InvestmentActorType; id?: string }
  reason: string
  expectedVersion?: number
  correlationId?: string
  metadata?: Record<string, unknown>
  session?: ClientSession
}

export interface InvestmentTransitionResult {
  investment: any
  previousStatus: InvestmentStatus
  nextStatus: InvestmentStatus
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
 * The single authoritative entry point for individual investment status changes.
 * Bulk transitions (e.g., all investments for a vehicle when a loan activates)
 * are handled directly by the loan transition service within its own session.
 */
export async function transitionInvestment(
  input: InvestmentTransitionInput,
): Promise<InvestmentTransitionResult> {
  await dbConnect()

  if (!input.reason?.trim()) {
    throw new DomainTransitionError("REASON_REQUIRED", "A reason is required for every investment state transition.")
  }

  const investmentObjectId = toObjectId(input.investmentId, "investment id")
  const targetStatus = COMMAND_TARGET[input.command]

  try {
    return await runInSession(input.session, async (session) => {
      const investment = await Investment.findById(investmentObjectId).session(session)
      if (!investment) throw new DomainTransitionError("NOT_FOUND", "Investment not found.")

      const from = (investment.status || "Funding") as InvestmentStatus
      const to = targetStatus

      if (from === to) {
        return { investment, previousStatus: from, nextStatus: to }
      }

      if (isTerminalInvestmentState(from)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Investment is in a terminal state '${from}' and cannot be transitioned.`,
        )
      }

      if (!isValidInvestmentTransition(from, to)) {
        throw new DomainTransitionError(
          "INVALID_TRANSITION",
          `Cannot transition investment from '${from}' to '${to}'.`,
        )
      }

      if (!isInvestmentActorAllowed(to, input.actor.type)) {
        throw new DomainTransitionError(
          "FORBIDDEN_ACTOR",
          `Actor type '${input.actor.type}' is not permitted to transition an investment to '${to}'.`,
        )
      }

      const expectedVersion = input.expectedVersion ?? (investment.version ?? 0)
      const versionCondition =
        expectedVersion === 0
          ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
          : { version: expectedVersion }

      const updated = await Investment.findOneAndUpdate(
        { _id: investment._id, ...versionCondition },
        { $set: { status: to }, $inc: { version: 1 } },
        { session, new: true },
      )

      if (!updated) throw new DomainConcurrencyError("investment")

      await StateTransitionHistory.create(
        [
          {
            entityType: "investment",
            entityId: investment._id,
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
        action: `investment.transition.${to.toLowerCase()}`,
        targetType: "investment",
        targetId: investment._id.toString(),
        metadata: {
          fromState: from,
          toState: to,
          command: input.command,
          reason: input.reason,
          actorType: input.actor.type,
          correlationId: input.correlationId,
        },
      })

      return { investment: updated, previousStatus: from, nextStatus: to }
    })
  } catch (err) {
    if (isWriteConflict(err)) throw new DomainConcurrencyError("investment")
    throw err
  }
}
