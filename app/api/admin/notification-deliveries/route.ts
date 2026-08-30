import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuthenticatedUser, finalizeAuthenticatedResponse } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import NotificationDelivery from "@/models/NotificationDelivery"

const querySchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  status: z.enum(["created", "scheduled", "processing", "delivered", "dead_letter"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request, ["admin"], { forbiddenMessage: "Admin access required" })
  if ("response" in auth) return auth.response
  const query = parseSearchParams(request, querySchema)
  if ("response" in query) return query.response
  await dbConnect()
  const filter = { ...(query.data.userId ? { userId: query.data.userId } : {}), ...(query.data.status ? { status: query.data.status } : {}) }
  const deliveries = await NotificationDelivery.find(filter).select("-html -to").sort({ createdAt: -1 }).limit(query.data.limit).lean()
  return finalizeAuthenticatedResponse(NextResponse.json({ success: true, deliveries }), auth)
}
