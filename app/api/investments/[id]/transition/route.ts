import { NextResponse } from "next/server"
import mongoose from "mongoose"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import {
  transitionInvestment,
  DomainTransitionError,
  DomainConcurrencyError,
  type InvestmentCommand,
} from "@/lib/domain/investment-transition-service"

const VALID_COMMANDS = new Set<InvestmentCommand>(["activate", "complete"])

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
}

async function requireAdmin(request: Request) {
  const authContext = await getAuthenticatedUser(request)
  if (!authContext.user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (authContext.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  }
  return authContext
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await dbConnect()

    const { id } = await params
    if (!isObjectId(id)) {
      return NextResponse.json({ error: "Invalid investment id" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const command = typeof body.command === "string" ? body.command : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    const expectedVersion =
      typeof body.expectedVersion === "number" ? body.expectedVersion : undefined

    if (!VALID_COMMANDS.has(command as InvestmentCommand)) {
      return NextResponse.json(
        {
          error: `Invalid command '${command}'. Valid commands: ${[...VALID_COMMANDS].join(", ")}`,
        },
        { status: 400 },
      )
    }

    if (!reason) {
      return NextResponse.json({ error: "A reason is required." }, { status: 400 })
    }

    const authContext = await requireAdmin(request)
    if ("response" in authContext) return authContext.response

    const result = await transitionInvestment({
      investmentId: id,
      command: command as InvestmentCommand,
      actor: { type: "admin", id: authContext.user!._id.toString() },
      reason,
      expectedVersion,
    })

    const response = NextResponse.json(
      {
        message: `Investment transitioned to '${result.nextStatus}'.`,
        investment: result.investment,
        previousStatus: result.previousStatus,
        nextStatus: result.nextStatus,
      },
      { status: 200 },
    )

    return authContext.shouldRefreshSession ? withSessionRefresh(response, authContext.user) : response
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
    console.error("INVESTMENT_TRANSITION_ERROR", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
