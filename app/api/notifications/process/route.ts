import { NextResponse } from "next/server"
import { timingSafeEqualString } from "@/lib/security/constant-time-compare"
import { processEmailJobs } from "@/lib/notifications/service"

export async function POST(request: Request) {
  const secret = process.env.NOTIFICATION_WORKER_SECRET
  if (!secret || !timingSafeEqualString(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await processEmailJobs())
}
