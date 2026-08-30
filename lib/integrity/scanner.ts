import dbConnect from "@/lib/dbConnect"
import InvariantFinding, { IInvariantFinding } from "@/models/InvariantFinding"
import { INVARIANT_CATALOG, InvariantRule, RawFinding } from "./catalog"
import { generateJsonSummary, redactPii } from "./reporting"

export interface ScanOptions {
  ruleIds?: string[]
  persist?: boolean
}

export interface ScanResult {
  startedAt: string
  completedAt: string
  rulesExecuted: number
  findingsDetected: number
  findingsPersisted: number
  summary: ReturnType<typeof generateJsonSummary>
}

/**
 * Streaming / batched scanner engine for cross-model invariant checks.
 */
export async function runInvariantScan(options: ScanOptions = {}): Promise<ScanResult> {
  await dbConnect()

  const startedAt = new Date().toISOString()
  const { ruleIds, persist = true } = options

  const targetRules: InvariantRule[] = ruleIds && ruleIds.length > 0
    ? INVARIANT_CATALOG.filter((r) => ruleIds.includes(r.ruleId))
    : INVARIANT_CATALOG

  const allDetectedFindings: RawFinding[] = []

  for (const rule of targetRules) {
    try {
      const ruleFindings = await rule.scan()
      allDetectedFindings.push(...ruleFindings)
    } catch (error) {
      console.error(`[DataIntegrityScanner] Error running rule ${rule.ruleId}:`, error)
    }
  }

  let persistedCount = 0
  const persistedFindings: IInvariantFinding[] = []

  if (persist) {
    for (const raw of allDetectedFindings) {
      const sanitizedExplanation = redactPii(raw.explanation)
      const sanitizedDetails = raw.details ? redactPii(raw.details) : undefined

      const existing = await InvariantFinding.findOne({ fingerprint: raw.fingerprint })

      if (existing) {
        existing.lastSeenAt = new Date()
        existing.scanCount += 1
        existing.explanation = sanitizedExplanation
        existing.details = sanitizedDetails
        existing.severity = raw.severity
        existing.repairability = raw.repairability

        // If previously marked REPAIRED but issue re-appeared, mark OPEN again
        if (existing.status === "REPAIRED") {
          existing.status = "OPEN"
        }

        await existing.save()
        persistedFindings.push(existing as unknown as IInvariantFinding)
        persistedCount++
      } else {
        const created = await InvariantFinding.create({
          fingerprint: raw.fingerprint,
          ruleId: raw.ruleId,
          severity: raw.severity,
          category: raw.category,
          primaryModel: raw.primaryModel,
          primaryId: raw.primaryId,
          relatedModel: raw.relatedModel,
          relatedId: raw.relatedId,
          explanation: sanitizedExplanation,
          details: sanitizedDetails,
          repairability: raw.repairability,
          status: "OPEN",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          scanCount: 1,
          resolutionHistory: [],
        })
        persistedFindings.push(created as unknown as IInvariantFinding)
        persistedCount++
      }
    }
  }

  const completedAt = new Date().toISOString()
  const findingsList = persist
    ? persistedFindings
    : allDetectedFindings.map((f) => ({ ...f, _id: f.fingerprint }))

  const summary = generateJsonSummary(findingsList as any)

  return {
    startedAt,
    completedAt,
    rulesExecuted: targetRules.length,
    findingsDetected: allDetectedFindings.length,
    findingsPersisted: persistedCount,
    summary,
  }
}
