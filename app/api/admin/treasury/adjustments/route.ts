import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuthenticatedUser, finalizeAuthenticatedResponse } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import { TREASURY_BUCKETS } from "@/lib/treasury/service"
import dbConnect from "@/lib/dbConnect"
import TreasuryAdjustmentProposal from "@/models/TreasuryAdjustmentProposal"
import { logAuditEvent } from "@/lib/security/audit-log"

const proposalSchema = z.object({ bucket: z.enum(TREASURY_BUCKETS), amountMinor: z.number().int().positive(), currency: z.string().min(3).max(3), reason: z.string().trim().min(10).max(1000) })
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request, ["admin"])
  if ("response" in auth) return auth.response
  const parsed = await parseJsonBody(request, proposalSchema)
  if ("response" in parsed) return parsed.response
  await dbConnect()
  const proposal = await TreasuryAdjustmentProposal.create({ ...parsed.data, proposedBy: auth.user._id, history: [{ action: "proposed", actorId: auth.user._id, reason: parsed.data.reason, timestamp: new Date() }] })
  await logAuditEvent({ actor: auth.user, action: "treasury.adjustment.proposed", targetType: "TreasuryAdjustmentProposal", targetId: proposal._id.toString(), metadata: { bucket: parsed.data.bucket, amountMinor: parsed.data.amountMinor }, criticalAction: true })
  return finalizeAuthenticatedResponse(NextResponse.json({ success: true, proposal: { id: proposal._id, status: proposal.status } }, { status: 201 }), auth)
}
