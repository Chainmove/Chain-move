import crypto from "crypto"

/**
 * Canonicalize audit event data for consistent hashing
 * This ensures that the same event data always produces the same hash
 */
export function canonicalizeEventData(eventData: Record<string, unknown>): string {
  const sortedData = sortObjectKeys(eventData)
  return JSON.stringify(sortedData)
}

/**
 * Recursively sort object keys for canonical representation
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {}
    const keys = Object.keys(obj).sort()

    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
    }

    return sorted
  }

  return obj
}

/**
 * Compute SHA-256 hash of the canonical event data
 */
export function computeEventHash(canonicalData: string): string {
  return crypto.createHash("sha256").update(canonicalData).digest("hex")
}

/**
 * Compute hash of a chain link (previous hash + current event data)
 */
export function computeChainHash(previousHash: string, eventData: Record<string, unknown>): string {
  const canonicalData = canonicalizeEventData(eventData)
  const combined = previousHash + canonicalData
  return crypto.createHash("sha256").update(combined).digest("hex")
}

export interface CanonicalAuditEventData extends Record<string, unknown> {
  sequence: number
  eventId: string
  actorId?: string
  actorRole?: string
  actorIdentifier?: string
  action: string
  targetType: string
  targetId?: string
  status: string
  requestId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  timestamp: string
  partition: string
  previousHash: string
  isLegacy?: boolean
}

export function buildCanonicalAuditEventData(event: {
  sequence: number
  eventId: string
  actorId?: string | null
  actorRole?: string | null
  actorIdentifier?: string | null
  action: string
  targetType: string
  targetId?: string | null
  status: string
  requestId?: string | null
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  timestamp: Date | string
  partition: string
  previousHash: string
  isLegacy?: boolean
}): CanonicalAuditEventData {
  const timestamp =
    event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp).toISOString()

  return {
    sequence: event.sequence,
    eventId: event.eventId,
    actorId: event.actorId || undefined,
    actorRole: event.actorRole || undefined,
    actorIdentifier: event.actorIdentifier || undefined,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId || undefined,
    status: event.status,
    requestId: event.requestId || undefined,
    metadata: event.metadata || undefined,
    ipAddress: event.ipAddress || undefined,
    userAgent: event.userAgent || undefined,
    timestamp,
    partition: event.partition,
    previousHash: event.previousHash,
    isLegacy: event.isLegacy || undefined,
  }
}

/**
 * Compute root hash for a range of events (Merkle-like approach)
 */
export function computeRootHash(eventHashes: string[]): string {
  if (eventHashes.length === 0) {
    return crypto.createHash("sha256").update("EMPTY_ROOT").digest("hex")
  }

  if (eventHashes.length === 1) {
    return eventHashes[0]
  }

  // Combine all hashes in order
  const combined = eventHashes.join("")
  return crypto.createHash("sha256").update(combined).digest("hex")
}

/**
 * Genesis hash for the start of a partition
 */
export function getGenesisHash(partition: string): string {
  return crypto.createHash("sha256").update(`GENESIS:${partition}`).digest("hex")
}

/**
 * Sanitize metadata to remove sensitive information
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined

  const sanitized = { ...metadata }

  // Remove sensitive fields
  const sensitiveFields = [
    "password",
    "token",
    "secret",
    "apiKey",
    "privateKey",
    "accessToken",
    "refreshToken",
    "sessionId",
    "kycDocument",
    "rawKycData",
    "ssn",
    "taxId",
    "creditCard",
    "bankAccount",
  ]

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      delete sanitized[field]
    }
  }

  // Recursively sanitize nested objects
  for (const [key, value] of Object.entries(sanitized)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>)
    }
  }

  return sanitized
}

/**
 * Redact PII from metadata while keeping structure
 */
export function redactPII(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined

  const redacted = { ...metadata }

  // Fields that may contain PII but we want to keep the structure
  const piiFields = ["email", "phone", "address", "name", "firstName", "lastName"]

  for (const field of piiFields) {
    if (field in redacted && typeof redacted[field] === "string") {
      const value = redacted[field] as string
      // Keep first 2 and last 2 characters, redact middle
      if (value.length > 4) {
        redacted[field] = `${value.slice(0, 2)}***${value.slice(-2)}`
      } else {
        redacted[field] = "***"
      }
    }
  }

  // Recursively redact nested objects
  for (const [key, value] of Object.entries(redacted)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactPII(value as Record<string, unknown>)
    }
  }

  return redacted
}
