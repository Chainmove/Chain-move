#!/usr/bin/env tsx
/**
 * Audit Verification CLI
 *
 * Usage:
 *   npm run audit:verify -- --partition=2026-07
 *   npm run audit:verify -- --partition=2026-07 --checkpoints
 *   npm run audit:verify -- --all
 *   npm run audit:verify -- --file=audit-export.json
 */

import fs from "fs"
import { detectAnomalies, verifyAuditChain, verifyAuditExportPayload } from "@/lib/security/audit-verification"
import { getCurrentPartition } from "@/lib/security/tamper-evident-audit"
import dbConnect from "@/lib/dbConnect"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"

type VerificationOutput = Awaited<ReturnType<typeof verifyAuditChain>>

async function main() {
  const args = process.argv.slice(2)
  const partitionArg = args.find((arg) => arg.startsWith("--partition="))?.split("=")[1]
  const fileArg = args.find((arg) => arg.startsWith("--file="))?.split("=")[1]
  const verifyCheckpoints = args.includes("--checkpoints")
  const verifyAll = args.includes("--all")

  if (fileArg) {
    const payload = JSON.parse(fs.readFileSync(fileArg, "utf-8"))
    const result = verifyAuditExportPayload(payload)
    printResult(result, fileArg)
    process.exit(result.valid ? 0 : 1)
  }

  await dbConnect()

  if (verifyAll) {
    const partitions = await TamperEvidentAuditLog.distinct("partition")
    for (const partition of partitions) {
      await verifyPartition(partition, verifyCheckpoints)
    }
  } else {
    await verifyPartition(partitionArg || getCurrentPartition(), verifyCheckpoints)
  }
}

async function verifyPartition(partition: string, verifyCheckpoints: boolean) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`Verifying partition: ${partition}`)
  console.log(`${"=".repeat(60)}\n`)

  const result = await verifyAuditChain(partition, { verifyCheckpoints })
  printResult(result, partition)

  const anomalies = await detectAnomalies(partition)

  if (anomalies.missingSequences.length > 0) {
    console.log(`\nERROR Missing Sequences (${anomalies.missingSequences.length}):`)
    console.log(`  ${anomalies.missingSequences.slice(0, 10).join(", ")}${anomalies.missingSequences.length > 10 ? "..." : ""}`)
  }

  if (anomalies.duplicateSequences.length > 0) {
    console.log(`\nERROR Duplicate Sequences (${anomalies.duplicateSequences.length}):`)
    console.log(`  ${anomalies.duplicateSequences.slice(0, 10).join(", ")}${anomalies.duplicateSequences.length > 10 ? "..." : ""}`)
  }

  if (anomalies.outOfOrderEvents.length > 0) {
    console.log(`\nWARN Out-of-Order Timestamps (${anomalies.outOfOrderEvents.length}):`)
    for (const event of anomalies.outOfOrderEvents.slice(0, 5)) {
      console.log(`  Sequence ${event.sequence}: ${event.timestamp.toISOString()}`)
    }
  }

  if (
    result.valid &&
    anomalies.missingSequences.length === 0 &&
    anomalies.duplicateSequences.length === 0 &&
    anomalies.outOfOrderEvents.length === 0
  ) {
    console.log("\nOK No anomalies detected. Audit chain is intact.")
  }
}

function printResult(result: VerificationOutput, scope: string) {
  console.log("Verification Result:")
  console.log(`  Scope: ${scope}`)
  console.log(`  Status: ${result.valid ? "PASSED" : "FAILED"}`)
  console.log(`  Total Events: ${result.summary.totalEvents}`)
  console.log(`  Events Verified: ${result.summary.eventsVerified}`)
  console.log(`  Sequence Range: ${result.summary.firstSequence} - ${result.summary.lastSequence}`)
  if (result.summary.checkpointsVerified !== undefined) {
    console.log(`  Checkpoints Verified: ${result.summary.checkpointsVerified}`)
  }
  console.log(`  Errors: ${result.errors.length}`)
  console.log(`  Warnings: ${result.warnings.length}`)

  for (const error of result.errors) {
    console.log(`  ERROR [${error.type}] ${error.message}`)
    if (error.sequence !== undefined) console.log(`    Sequence: ${error.sequence}`)
    if (error.eventId) console.log(`    Event ID: ${error.eventId}`)
  }

  for (const warning of result.warnings) {
    console.log(`  WARN [${warning.type}] ${warning.message}`)
  }
}

main().catch((error) => {
  console.error("Verification failed:", error)
  process.exit(1)
})
