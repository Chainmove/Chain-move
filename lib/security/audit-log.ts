import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"
import { logTamperEvidentAuditEvent } from "./tamper-evident-audit"

type AuditActor = {
  _id?: { toString(): string }
  role?: string
} | null

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined

  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
}

const DEFAULT_CRITICAL_ACTION_PATTERNS = [
  "kyc",
  "wallet",
  "repayment",
  "payout",
  "loan",
  "asset",
  "investment",
  "contract",
  "admin",
  "user.role",
  "notification.broadcast",
  "email.send",
]

function isCriticalAuditAction(action: string) {
  const configured = process.env.CRITICAL_AUDIT_ACTIONS?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const patterns = configured && configured.length > 0 ? configured : DEFAULT_CRITICAL_ACTION_PATTERNS
  const normalizedAction = action.toLowerCase()

  return patterns.some((pattern) => normalizedAction.includes(pattern))
}

export async function logAuditEvent({
  actor,
  action,
  targetType,
  targetId,
  status = "success",
  ipAddress,
  requestId,
  userAgent,
  metadata,
  criticalAction,
}: {
  actor?: AuditActor
  action: string
  targetType: string
  targetId?: string | null
  status?: "success" | "failure"
  ipAddress?: string | null
  requestId?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
  criticalAction?: boolean
}) {
  const sanitizedMetadata = sanitizeMetadata(metadata)
  const mustWrite = criticalAction ?? isCriticalAuditAction(action)

  const tamperEvidentResult = await logTamperEvidentAuditEvent({
    actor,
    action,
    targetType,
    targetId,
    status,
    requestId,
    ipAddress,
    userAgent,
    metadata: sanitizedMetadata,
    criticalAction: mustWrite,
  })

  if (!tamperEvidentResult.success && mustWrite) {
    throw new Error(`CRITICAL_AUDIT_FAILURE: ${tamperEvidentResult.error || "Unknown error"}`)
  }

  try {
    await dbConnect()
    await AuditLog.create({
      actorId: actor?._id?.toString() || undefined,
      actorRole:
        actor?.role === "admin" || actor?.role === "driver" || actor?.role === "investor"
          ? actor.role
          : undefined,
      action,
      targetType,
      targetId: targetId || undefined,
      status,
      ipAddress: ipAddress || undefined,
      metadata: sanitizedMetadata,
    })
  } catch (error) {
    console.error("AUDIT_LOG_WRITE_ERROR", error)
    if (mustWrite && !tamperEvidentResult.success) {
      throw error
    }
  }
}
