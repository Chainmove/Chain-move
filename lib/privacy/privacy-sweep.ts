/**
 * Periodic sweep job for the privacy lifecycle. Runs three maintenance
 * tasks that have to happen without human action:
 *
 *   1. Advance deletion requests whose cooling-off period has elapsed.
 *   2. Mark expired archives as EXPIRED and wipe them from disk.
 *   3. Mark expired legal holds as EXPIRED.
 *
 * Designed to be invoked from a cron / scheduled task. Idempotent — safe
 * to run repeatedly.
 */

import { advanceDueCoolingOffRequests } from "@/lib/privacy/privacy.service"
import { sweepExpiredArchives } from "@/lib/privacy/data-export.service"
import { expireLegalHolds } from "@/lib/privacy/legal-hold.service"
import { logAuditEvent } from "@/lib/security/audit-log"

export interface SweepReport {
  deletionsAdvanced: number
  archivesExpired: number
  holdsExpired: number
  ranAt: string
}

export async function runPrivacySweep(now: Date = new Date()): Promise<SweepReport> {
  const [deletionsAdvanced, archivesExpired, holdsExpired] = await Promise.all([
    advanceDueCoolingOffRequests(now),
    sweepExpiredArchives(now),
    expireLegalHolds(now),
  ])

  const report: SweepReport = {
    deletionsAdvanced,
    archivesExpired,
    holdsExpired,
    ranAt: now.toISOString(),
  }

  await logAuditEvent({
    actor: null,
    action: "privacy.sweep.completed",
    targetType: "PrivacySweep",
    targetId: "sweep",
    status: "success",
    metadata: { ...report },
  })

  return report
}
