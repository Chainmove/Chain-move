/**
 * GET /api/privacy/requests/[id]
 *
 * Returns the canonical state of a privacy request — used by the user
 * dashboard to display the request timeline and any blocking holds.
 */

import { NextResponse } from "next/server"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import { findRequestByIdForUser } from "@/lib/privacy/data-export.service"
import { summarizeRequestForUser } from "@/lib/privacy/privacy.service"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"])
    if ("response" in authContext) return authContext.response

    const privacyRequest = await findRequestByIdForUser(id, authContext.user._id.toString())
    if (!privacyRequest) {
      return NextResponse.json({ message: "Privacy request not found." }, { status: 404 })
    }

    const response = NextResponse.json({ request: summarizeRequestForUser(privacyRequest) })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_REQUEST_STATUS_ERROR", error)
    return NextResponse.json(
      { message: "Failed to load privacy request." },
      { status: 500 },
    )
  }
}
