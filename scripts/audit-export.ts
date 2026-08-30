#!/usr/bin/env tsx
/**
 * Audit Export CLI
 *
 * Usage:
 *   npm run audit:export -- --partition=2026-07 --output=export.json
 *   npm run audit:export -- --partition=2026-07 --format=csv --output=export.csv
 *   npm run audit:export -- --partition=2026-07 --redact-pii --checkpoints
 */

import fs from "fs"
import { exportAuditEvents, exportToCSV } from "@/lib/security/audit-export"
import { getCurrentPartition } from "@/lib/security/tamper-evident-audit"

async function main() {
  const args = process.argv.slice(2)
  const partitionArg = args.find((arg) => arg.startsWith("--partition="))?.split("=")[1]
  const outputArg = args.find((arg) => arg.startsWith("--output="))?.split("=")[1]
  const formatArg = args.find((arg) => arg.startsWith("--format="))?.split("=")[1] as "json" | "csv" | undefined
  const redactPII = args.includes("--redact-pii")
  const includeCheckpoints = args.includes("--checkpoints")
  const actionArgs = args.filter((arg) => arg.startsWith("--action=")).map((arg) => arg.split("=")[1])

  const partition = partitionArg || getCurrentPartition()
  const format = formatArg || "json"
  const output = outputArg || `audit-export-${partition}-${Date.now()}.${format}`

  console.log(`Exporting audit logs for partition: ${partition}`)
  console.log(`Output file: ${output}`)
  console.log(`Format: ${format}`)
  console.log(`Redact PII: ${redactPII}`)
  console.log(`Include Checkpoints: ${includeCheckpoints}`)
  if (actionArgs.length > 0) console.log(`Filter Actions: ${actionArgs.join(", ")}`)

  const exportResult = await exportAuditEvents({
    partition,
    actions: actionArgs.length > 0 ? actionArgs : undefined,
    redactPII,
    includeCheckpoints,
    format,
  })

  if (format === "csv") {
    fs.writeFileSync(output, exportToCSV(exportResult.events), "utf-8")
    console.log(`OK Exported ${exportResult.events.length} events to ${output}`)
  } else {
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          manifest: exportResult.manifest,
          events: exportResult.events,
          checkpoints: exportResult.checkpoints,
          verificationInstructions: exportResult.verificationInstructions,
        },
        null,
        2,
      ),
      "utf-8",
    )

    const instructionsFile = output.replace(/\.json$/, "-VERIFY.txt")
    fs.writeFileSync(instructionsFile, exportResult.verificationInstructions, "utf-8")
    console.log(`OK Exported ${exportResult.events.length} events to ${output}`)
    console.log(`OK Verification instructions written to ${instructionsFile}`)
  }

  console.log("Export Summary:")
  console.log(`  Total Events: ${exportResult.manifest.totalEvents}`)
  console.log(`  Sequence Range: ${exportResult.manifest.startSequence} - ${exportResult.manifest.endSequence}`)
  console.log(`  Integrity Verified: ${exportResult.manifest.integrity.verified ? "YES" : "NO"}`)
  console.log(`  Verification Errors: ${exportResult.manifest.integrity.verificationErrors}`)
  console.log(`  Verification Warnings: ${exportResult.manifest.integrity.verificationWarnings}`)
  if (exportResult.manifest.checkpoints) {
    console.log(`  Checkpoints Included: ${exportResult.manifest.checkpoints.count}`)
  }
}

main().catch((error) => {
  console.error("Export failed:", error)
  process.exit(1)
})
