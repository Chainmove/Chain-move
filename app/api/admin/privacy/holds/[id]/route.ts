/**
 * DELETE /api/admin/privacy/holds/[id]   — release an active hold.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedUser } from "@/lib/api/route-guard"
import { releaseLegalHold, summarizeHoldsForAdmin } from "@/lib/privacy/legal-hold.service"

const releaseSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
})

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    let parsed: { data: z.infer<typeof releaseSchema> } | { response: NextResponse }
    try {
      const text = await request.text()
      if (!text || text.trim().length === 0) {
        parsed = { data: { reason: "Released by admin" } }
      } else {
        parsed = { data: releaseSchema.parse(JSON.parse(text)) }
      }
    } catch (error) {
      return NextResponse.json(
        {
          message: "Invalid release body.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      )
    }
    if ("response" in parsed) return parsed.response

    const hold = await releaseLegalHold({
      id,
      reason: parsed.data.reason,
      actor: { id: authContext.user._id.toString(), role: "admin" },
    })

    if (!hold) {
      return NextResponse.json({ message: "Hold not found." }, { status: 404 })
    }

    return NextResponse.json({ hold: summarizeHoldsForAdmin([hold])[0] })
  } catch (error) {
    console.error("ADMIN_PRIVACY_HOLD_RELEASE_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to release hold.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
