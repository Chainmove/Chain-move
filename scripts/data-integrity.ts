import dbConnect from "../lib/dbConnect"
import { runInvariantScan } from "../lib/integrity/scanner"
import { applyRepair, previewRepair } from "../lib/integrity/repairEngine"
import { generateCsvExport } from "../lib/integrity/reporting"
import InvariantFinding from "../models/InvariantFinding"

async function main() {
  await dbConnect()

  const args = process.argv.slice(2)
  const isScan = args.includes("--scan")
  const isRepair = args.includes("--repair")
  const isDryRun = args.includes("--dry-run")
  const isApply = args.includes("--apply")
  const isScheduled = args.includes("--scheduled")
  const formatArg = args.find((a) => a.startsWith("--format="))?.split("=")[1] || "json"
  const findingArg = args.find((a) => a.startsWith("--finding="))?.split("=")[1]
  const ruleArg = args.find((a) => a.startsWith("--rule="))?.split("=")[1]

  if (isScheduled) {
    console.log(`[CLI Scheduled Check] Executing continuous invariant scan...`)
    const ruleIds = ruleArg ? [ruleArg] : undefined
    const scanResult = await runInvariantScan({ ruleIds })
    console.log(`[CLI Scheduled Check Complete] Findings Detected: ${scanResult.findingsDetected}, Rules Executed: ${scanResult.rulesExecuted}`)
    process.exit(0)
  }

  if (isRepair && findingArg) {
    if (isApply) {
      console.log(`[CLI] Applying repair for finding ${findingArg}...`)
      const result = await applyRepair(findingArg, "cli_user")
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`[CLI] Previewing repair (dry-run) for finding ${findingArg}...`)
      const preview = await previewRepair(findingArg)
      console.log(JSON.stringify(preview, null, 2))
    }
    process.exit(0)
  }

  if (isScan || (!isRepair && !findingArg)) {
    console.log(`[CLI] Executing cross-model invariant scan...`)
    const ruleIds = ruleArg ? [ruleArg] : undefined
    const scanResult = await runInvariantScan({ ruleIds })

    if (formatArg === "csv") {
      const findings = await InvariantFinding.find({}).lean()
      console.log(generateCsvExport(findings as any))
    } else {
      console.log(JSON.stringify(scanResult, null, 2))
    }
    process.exit(0)
  }

  console.log(`Usage:
  npx tsx scripts/data-integrity.ts --scan [--format=json|csv] [--rule=<RULE_ID>]
  npx tsx scripts/data-integrity.ts --repair --finding=<FINDING_ID> [--dry-run | --apply]
  npx tsx scripts/data-integrity.ts --scheduled
  `)
  process.exit(0)
}

main().catch((err) => {
  console.error("[CLI Error]", err)
  process.exit(1)
})
