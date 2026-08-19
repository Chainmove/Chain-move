import dbConnect from "@/lib/dbConnect"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"
import AuditCheckpoint from "@/models/AuditCheckpoint"
import { verifyAuditChain } from "./audit-verification"
import { buildCanonicalAuditEventData, canonicalizeEventData, computeEventHash, redactPII } from "./audit-hash"
import { createCsvStream } from "@/lib/exports/csv-stream"

export interface ExportOptions {
  partition: string
  startDate?: Date
  endDate?: Date
  startSequence?: number
  endSequence?: number
  actions?: string[]
  actorId?: string
  targetType?: string
  includeLegacy?: boolean
  redactPII?: boolean
  includeCheckpoints?: boolean
  format?: "json" | "csv"
}

export interface ExportResult {
  events: any[]
  checkpoints?: any[]
  manifest: ExportManifest
  verificationInstructions: string
}

export interface ExportManifest {
  exportedAt: Date
  partition: string
  totalEvents: number
  startSequence: number
  endSequence: number
  startEventHash: string
  endEventHash: string
  filters: {
    startDate?: Date
    endDate?: Date
    actions?: string[]
    actorId?: string
    targetType?: string
  }
  integrity: {
    verified: boolean
    verificationErrors: number
    verificationWarnings: number
  }
  checkpoints?: {
    included: boolean
    count: number
  }
  piiRedacted: boolean
}

const AUDIT_EXPORT_BATCH_SIZE = 250

function buildAuditExportQuery(options: ExportOptions) {
  const query: any = { partition: options.partition }
  if (!options.includeLegacy) query.isLegacy = false
  if (options.startDate || options.endDate) {
    query.timestamp = {}
    if (options.startDate) query.timestamp.$gte = options.startDate
    if (options.endDate) query.timestamp.$lte = options.endDate
  }
  if (options.startSequence !== undefined || options.endSequence !== undefined) {
    query.sequence = {}
    if (options.startSequence !== undefined) query.sequence.$gte = options.startSequence
    if (options.endSequence !== undefined) query.sequence.$lte = options.endSequence
  }
  if (options.actions?.length) query.action = { $in: options.actions }
  if (options.actorId) query.actorId = options.actorId
  if (options.targetType) query.targetType = options.targetType
  return query
}

/** Reads audit events in bounded database batches for response/file streaming. */
export async function* iterateAuditEvents(options: ExportOptions): AsyncGenerator<any> {
  await dbConnect()
  const cursor = TamperEvidentAuditLog.find(buildAuditExportQuery(options))
    .sort({ sequence: 1, _id: 1 })
    .lean()
    .cursor({ batchSize: AUDIT_EXPORT_BATCH_SIZE })
  let previousHash: string | undefined
  for await (const event of cursor as AsyncIterable<any>) {
    if (!options.redactPII) {
      yield event
      continue
    }
    const redactedEvent = {
      ...event,
      actorIdentifier: event.actorIdentifier ? "[REDACTED]" : event.actorIdentifier,
      metadata: redactPII(event.metadata),
      sourceEventHash: event.eventHash,
      previousHash: previousHash ?? event.previousHash,
    }
    const canonicalData = canonicalizeEventData(buildCanonicalAuditEventData(redactedEvent))
    const eventHash = computeEventHash(redactedEvent.previousHash + canonicalData)
    previousHash = eventHash
    yield { ...redactedEvent, canonicalData, eventHash }
  }
}

export function createAuditCsvStream(events: AsyncIterable<any>): ReadableStream<Uint8Array> {
  const headers = ["Sequence", "Event ID", "Timestamp", "Actor ID", "Actor Role", "Action", "Target Type", "Target ID", "Status", "Request ID", "IP Address", "Previous Hash", "Event Hash", "Is Legacy"]
  async function* rows(): AsyncGenerator<unknown[]> {
    for await (const event of events) yield [event.sequence, event.eventId, event.timestamp?.toISOString?.() ?? "", event.actorId || "", event.actorRole || "", event.action, event.targetType, event.targetId || "", event.status, event.requestId || "", event.ipAddress || "", event.previousHash, event.eventHash, event.isLegacy ? "true" : "false"]
  }
  return createCsvStream(headers, rows())
}

/**
 * Export audit events with integrity manifest
 */
export async function exportAuditEvents(options: ExportOptions): Promise<ExportResult> {
  await dbConnect()

  // Build query
  // Kept for the CLI's manifest-producing API. HTTP callers should use
  // iterateAuditEvents/createAuditCsvStream so output is never materialized.
  const events: any[] = []
  for await (const event of iterateAuditEvents(options)) events.push(event)

  // Fetch checkpoints if requested
  let checkpoints: any[] = []
  if (options.includeCheckpoints) {
    const checkpointQuery: any = {
      partition: options.partition,
    }

    if (options.startSequence !== undefined || options.endSequence !== undefined) {
      checkpointQuery.$or = [
        { startSequence: { $gte: options.startSequence, $lte: options.endSequence } },
        { endSequence: { $gte: options.startSequence, $lte: options.endSequence } },
      ]
    }

    checkpoints = await AuditCheckpoint.find(checkpointQuery).sort({ checkpointNumber: 1 }).lean()
  }

  // Verify integrity
  const verificationResult = await verifyAuditChain(options.partition, {
    startSequence: events.length > 0 ? events[0].sequence : undefined,
    endSequence: events.length > 0 ? events[events.length - 1].sequence : undefined,
    verifyCheckpoints: options.includeCheckpoints,
  })

  // Build manifest
  const manifest: ExportManifest = {
    exportedAt: new Date(),
    partition: options.partition,
    totalEvents: events.length,
    startSequence: events.length > 0 ? events[0].sequence : 0,
    endSequence: events.length > 0 ? events[events.length - 1].sequence : 0,
    startEventHash: events.length > 0 ? events[0].eventHash : "",
    endEventHash: events.length > 0 ? events[events.length - 1].eventHash : "",
    filters: {
      startDate: options.startDate,
      endDate: options.endDate,
      actions: options.actions,
      actorId: options.actorId,
      targetType: options.targetType,
    },
    integrity: {
      verified: verificationResult.valid,
      verificationErrors: verificationResult.errors.length,
      verificationWarnings: verificationResult.warnings.length,
    },
    checkpoints: options.includeCheckpoints
      ? {
          included: true,
          count: checkpoints.length,
        }
      : undefined,
    piiRedacted: options.redactPII || false,
  }

  // Generate verification instructions
  const verificationInstructions = generateVerificationInstructions(manifest)

  return {
    events,
    checkpoints: options.includeCheckpoints ? checkpoints : undefined,
    manifest,
    verificationInstructions,
  }
}

/**
 * Generate verification instructions for offline verification
 */
function generateVerificationInstructions(manifest: ExportManifest): string {
  return `
AUDIT LOG EXPORT VERIFICATION INSTRUCTIONS
==========================================

Export Information:
- Partition: ${manifest.partition}
- Exported At: ${manifest.exportedAt.toISOString()}
- Total Events: ${manifest.totalEvents}
- Sequence Range: ${manifest.startSequence} to ${manifest.endSequence}
- PII Redacted: ${manifest.piiRedacted ? "Yes" : "No"}

Integrity Status:
- Verified: ${manifest.integrity.verified ? "PASSED" : "FAILED"}
- Verification Errors: ${manifest.integrity.verificationErrors}
- Verification Warnings: ${manifest.integrity.verificationWarnings}

Hash Chain Verification:
1. First Event Hash: ${manifest.startEventHash}
2. Last Event Hash: ${manifest.endEventHash}

To verify this export offline:

1. Install project dependencies:
   npm install

2. Run verification:
   npm run audit:verify -- --file=export.json

3. Manual verification steps:
   a) Check sequence continuity (no gaps in sequence numbers)
   b) Verify each event hash matches its canonical data
   c) Verify previous hash chain links
   d) Verify checkpoint signatures (if included)

Filters Applied:
${manifest.filters.startDate ? `- Start Date: ${manifest.filters.startDate.toISOString()}` : ""}
${manifest.filters.endDate ? `- End Date: ${manifest.filters.endDate.toISOString()}` : ""}
${manifest.filters.actions ? `- Actions: ${manifest.filters.actions.join(", ")}` : ""}
${manifest.filters.actorId ? `- Actor ID: ${manifest.filters.actorId}` : ""}
${manifest.filters.targetType ? `- Target Type: ${manifest.filters.targetType}` : ""}

Checkpoints:
${manifest.checkpoints ? `- Included: Yes (${manifest.checkpoints.count} checkpoints)` : "- Included: No"}

For questions or issues, contact: security@chainmove.com
`.trim()
}

/**
 * Export to CSV format
 */
export function exportToCSV(events: any[]): string {
  const headers = [
    "Sequence",
    "Event ID",
    "Timestamp",
    "Actor ID",
    "Actor Role",
    "Action",
    "Target Type",
    "Target ID",
    "Status",
    "Request ID",
    "IP Address",
    "Previous Hash",
    "Event Hash",
    "Is Legacy",
  ]

  const rows = events.map((event) => [
    event.sequence,
    event.eventId,
    event.timestamp.toISOString(),
    event.actorId || "",
    event.actorRole || "",
    event.action,
    event.targetType,
    event.targetId || "",
    event.status,
    event.requestId || "",
    event.ipAddress || "",
    event.previousHash,
    event.eventHash,
    event.isLegacy ? "true" : "false",
  ])

  const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n")

  return csvContent
}

/**
 * Generate integrity report for a partition
 */
export async function generateIntegrityReport(partition: string): Promise<{
  report: string
  summary: {
    totalEvents: number
    legacyEvents: number
    verifiedEvents: number
    errors: number
    warnings: number
    checkpoints: number
  }
}> {
  await dbConnect()

  const totalEvents = await TamperEvidentAuditLog.countDocuments({ partition })
  const legacyEvents = await TamperEvidentAuditLog.countDocuments({ partition, isLegacy: true })
  const checkpoints = await AuditCheckpoint.countDocuments({ partition })

  const verificationResult = await verifyAuditChain(partition, { verifyCheckpoints: true })

  const report = `
AUDIT LOG INTEGRITY REPORT
=========================

Partition: ${partition}
Generated: ${new Date().toISOString()}

Summary:
--------
Total Events: ${totalEvents}
Legacy Events: ${legacyEvents}
Verifiable Events: ${totalEvents - legacyEvents}
Events Verified: ${verificationResult.summary.eventsVerified}
Checkpoints: ${checkpoints}

Integrity Status: ${verificationResult.valid ? "PASSED" : "FAILED"}
Errors: ${verificationResult.errors.length}
Warnings: ${verificationResult.warnings.length}

${verificationResult.errors.length > 0 ? `
Errors:
-------
${verificationResult.errors.map((e) => `- [${e.type}] ${e.message}`).join("\n")}
` : ""}

${verificationResult.warnings.length > 0 ? `
Warnings:
---------
${verificationResult.warnings.map((w) => `- [${w.type}] ${w.message}`).join("\n")}
` : ""}

Recommendations:
---------------
${verificationResult.errors.length > 0 ? "- Investigate and resolve integrity errors immediately" : ""}
${verificationResult.warnings.length > 0 ? "- Review and address warnings" : ""}
${checkpoints === 0 && totalEvents > 1000 ? "- Create checkpoints for this partition" : ""}
${legacyEvents > 0 ? `- ${legacyEvents} legacy events cannot be verified` : ""}
`.trim()

  return {
    report,
    summary: {
      totalEvents,
      legacyEvents,
      verifiedEvents: verificationResult.summary.eventsVerified,
      errors: verificationResult.errors.length,
      warnings: verificationResult.warnings.length,
      checkpoints,
    },
  }
}
