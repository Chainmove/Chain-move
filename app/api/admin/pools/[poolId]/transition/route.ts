import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import dbConnect from "@/lib/dbConnect"
import {
  transitionPoolStatus,
} from "@/lib/services/pool-lifecycle.service"
import User from "@/models/User"
import type { PoolStatus } from "@/models/InvestmentPool"

async function requireAdmin(): Promise<{ id: string } | null> {
  const session = await getSessionFromCookies()
  if (!session?.userId) return null
  await dbConnect()
  const user = await User.findById(session.userId).select("role").lean()
  if (!user || user.role !== "admin") return null
  return { id: user._id.toString() }
}

/**
 * POST /api/admin/pools/:poolId/transition
 *
 * Admin-only endpoint to advance or revert a pool's lifecycle status.
 * All transitions are validated against the allowed transition matrix and
 * recorded in PoolTransitionHistory with a correlation ID.
 *
 * Body: { toStatus: PoolStatus, reason?: string }
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ poolId: string }> },
) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  const { poolId } = await context.params

  let body: { toStatus?: PoolStatus; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 })
  }

  const { toStatus, reason } = body

  if (!toStatus) {
    return NextResponse.json({ message: "toStatus is required." }, { status: 400 })
  }

  try {
    const result = await transitionPoolStatus(poolId, toStatus as any, {
      actorId: admin.id,
      actorRole: "admin",
      reason,
    })
    return NextResponse.json({ success: true, ...result }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transition failed."
    return NextResponse.json({ message }, { status: 422 })
  }
}
