import { NextResponse } from "next/server"

import { newCorrelationId } from "@/lib/api/errors"
import { logger } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

/** Safe liveness/readiness signal: deliberately omits connection strings and configuration values. */
export async function GET() {
  const correlationId = newCorrelationId()
  const requiredConfigPresent = Boolean(process.env.MONGODB_URI && process.env.JWT_SECRET)
  const status = requiredConfigPresent ? "ready" : "degraded"
  logger.info({ event: "health.check", correlationId, status })

  return NextResponse.json(
    { status, checks: { configuration: requiredConfigPresent ? "ok" : "missing" } },
    { status: requiredConfigPresent ? 200 : 503, headers: { "X-Correlation-Id": correlationId } },
  )
}
