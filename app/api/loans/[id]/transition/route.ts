import { NextResponse } from "next/server"
import mongoose from "mongoose"

import { authorizeRequest } from "@/lib/authorization/route"
import { withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import { transitionLoan, DomainTransitionError, DomainConcurrencyError } from "@/lib/domain/loan-transition-service"
import { type LoanCommand } from "@/lib/domain/loan-transition-service"

const VALID_COMMANDS = new Set<LoanCommand>([
  "startReview",
  "approve",
  "reject",
  "activate",
  "complete",
  "cancel",
])

const COMMAND_ACTIONS: Record<LoanCommand, string> = {
  startReview: "loan:approve",
  approve: "loan:approve",
  reject: "loan:approve",
  activate: "loan:approve",
  complete: "loan:approve",
  cancel: "loan:cancel",
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await dbConnect()

    const { id } = await params
    if (!isObjectId(id)) {
      return NextResponse.json({ error: "Invalid loan id" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const command = typeof body.command === "string" ? body.command : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    const adminNotes = typeof body.adminNotes === "string" ? body.adminNotes.trim() : undefined
    const expectedVersion =
      typeof body.expectedVersion === "number" ? body.expectedVersion : undefined

    if (!VALID_COMMANDS.has(command as LoanCommand)) {
      return NextResponse.json(
        { error: `Invalid command '${command}'. Valid commands: ${[...VALID_COMMANDS].join(", ")}` },
        { status: 400 },
      )
    }

    if (!reason) {
      return NextResponse.json({ error: "A reason is required." }, { status: 400 })
    }

    const typedCommand = command as LoanCommand
    const auth = await authorizeRequest(request, COMMAND_ACTIONS[typedCommand] as any, {
      type: "loan",
    })
    if ("response" in auth) return auth.response
    const { user, shouldRefreshSession } = auth

    const actorType = user.role === "admin" ? "admin" : "driver"

    const result = await transitionLoan({
      loanId: id,
      command: typedCommand,
      actor: { type: actorType, id: user._id.toString() },
      reason,
      adminNotes,
      expectedVersion,
    })

    const response = NextResponse.json(
      {
        message: `Loan transitioned to '${result.nextStatus}'.`,
        loan: { ...result.loan.toObject(), id: result.loan._id.toString() },
        previousStatus: result.previousStatus,
        nextStatus: result.nextStatus,
      },
      { status: 200 },
    )

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (err) {
    if (err instanceof DomainConcurrencyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    }
    if (err instanceof DomainTransitionError) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_TRANSITION: 409,
        FORBIDDEN_ACTOR: 403,
        PRECONDITION_FAILED: 422,
        REASON_REQUIRED: 400,
        INVALID_INPUT: 400,
      }
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: statusMap[err.code] ?? 400 },
      )
    }
    console.error("LOAN_TRANSITION_ERROR", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
