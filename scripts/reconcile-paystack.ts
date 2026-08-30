import dbConnect from "../lib/dbConnect"
import { PaystackAdapter } from "../lib/paystack/paystackAdapter"
import { MockPaystackAdapter } from "../lib/paystack/mockAdapter"
import { remediateDiscrepancy, runReconciliation } from "../lib/reconciliation/reconciliationEngine"
import {
  generateReconciliationCsvExport,
  generateReconciliationJsonSummary,
} from "../lib/reconciliation/reporting"
import ReconciliationDiscrepancy from "../models/ReconciliationDiscrepancy"

export async function runCliReconciliation() {
  await dbConnect()

  const args = process.argv.slice(2)
  const isMock = args.includes("--mock")
  const formatArg = args.find((a) => a.startsWith("--format="))?.split("=")[1] || "json"
  const startDateArg = args.find((a) => a.startsWith("--startDate="))?.split("=")[1]
  const endDateArg = args.find((a) => a.startsWith("--endDate="))?.split("=")[1]
  const isRemediate = args.includes("--remediate")
  const discrepancyId = args.find((a) => a.startsWith("--discrepancy="))?.split("=")[1]
  const actionArg = args.find((a) => a.startsWith("--action="))?.split("=")[1] as any

  if (isRemediate && discrepancyId && actionArg) {
    console.log(`[CLI] Remediating discrepancy ${discrepancyId} with action ${actionArg}...`)
    const result = await remediateDiscrepancy(
      discrepancyId,
      actionArg,
      "000000000000000000000000",
      "CLI Automated Remediation Trigger",
    )
    console.log("[CLI Remediation Result]", result)
    return
  }

  const now = new Date()
  const periodEnd = endDateArg ? new Date(endDateArg) : now
  const periodStart = startDateArg
    ? new Date(startDateArg)
    : new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000)

  console.log(`[CLI] Running Paystack Settlement Reconciliation for period [${periodStart.toISOString()} -> ${periodEnd.toISOString()}]...`)

  const adapter = isMock ? new MockPaystackAdapter() : new PaystackAdapter()
  const reconResult = await runReconciliation({
    periodStart,
    periodEnd,
    adapter,
    triggeredBy: "cli",
  })

  if (formatArg === "csv") {
    const csvOutput = generateReconciliationCsvExport(reconResult.discrepancies)
    console.log(csvOutput)
  } else {
    const jsonSummary = generateReconciliationJsonSummary(
      reconResult.run,
      reconResult.discrepancies,
    )
    console.log(JSON.stringify(jsonSummary, null, 2))
  }
}

if (require.main === module) {
  runCliReconciliation()
    .then(() => {
      console.log("[CLI Success] Reconciliation task finished.")
      process.exit(0)
    })
    .catch((err) => {
      console.error("[CLI Error]", err)
      process.exit(1)
    })
}
