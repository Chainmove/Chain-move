#!/usr/bin/env tsx
/**
 * Schedule Regeneration / Check Script for Legacy Contracts
 *
 * Usage:
 *   tsx scripts/check-repayment-schedules.ts [--repair] [--contract-id <id>]
 *
 * Flags:
 *   --repair           Write corrected totalPaidNgn to MongoDB (dry-run by default)
 *   --contract-id <id> Check a single contract instead of all active contracts
 *
 * Exit codes:
 *   0  All contracts valid (or repaired)
 *   1  Issues found (dry-run); list printed to stdout
 */

import "dotenv/config"
import dbConnect from "@/lib/dbConnect"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import { checkContractSchedule, repairContractBalance } from "@/lib/repayments/repayment-engine.service"
import { validateScheduleTerms } from "@/lib/repayments/schedule-generator"

const args = process.argv.slice(2)
const REPAIR = args.includes("--repair")
const contractIdIndex = args.indexOf("--contract-id")
const SINGLE_CONTRACT_ID = contractIdIndex !== -1 ? args[contractIdIndex + 1] : null

async function main() {
  await dbConnect()

  let contractIds: string[]

  if (SINGLE_CONTRACT_ID) {
    contractIds = [SINGLE_CONTRACT_ID]
    console.log(`\n🔍 Checking single contract: ${SINGLE_CONTRACT_ID}\n`)
  } else {
    // Check all active (repayable) contracts.
    const contracts = await HirePurchaseContract.find({
      status: { $in: ["ACTIVE", "DELINQUENT", "RESTRUCTURED"] },
    })
      .select("_id")
      .lean()
    contractIds = contracts.map((c) => (c._id as any).toString())
    console.log(`\n🔍 Checking ${contractIds.length} active contracts (--repair=${REPAIR})\n`)
  }

  let issueCount = 0
  let repairedCount = 0

  for (const contractId of contractIds) {
    try {
      const result = await checkContractSchedule(contractId)

      if (result.valid) {
        console.log(`  ✅ ${contractId} — OK`)
        continue
      }

      issueCount++
      console.log(`  ❌ ${contractId} — ${result.issues.length} issue(s):`)
      for (const issue of result.issues) {
        console.log(`      · ${issue}`)
      }

      // Also run validateScheduleTerms for additional context.
      const contract = await HirePurchaseContract.findById(contractId).lean()
      const scheduleError = validateScheduleTerms(contract as any)
      if (scheduleError) {
        console.log(`      · Schedule validation: ${scheduleError}`)
      }

      if (REPAIR && !result.balanceConsistent && result.issues.some((i) => i.includes("totalPaidNgn"))) {
        try {
          const repairResult = await repairContractBalance(contractId)
          console.log(`      ✔ Repaired: totalPaidNgn set to ${repairResult.repairedAmountNgn.toFixed(2)}`)
          repairedCount++
        } catch (repairErr) {
          console.error(`      ✘ Repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`)
        }
      }
    } catch (err) {
      issueCount++
      console.error(`  ✘ ${contractId} — Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`\n─────────────────────────────────────────────────`)
  console.log(`Total contracts checked: ${contractIds.length}`)
  console.log(`Issues found:            ${issueCount}`)
  if (REPAIR) {
    console.log(`Contracts repaired:      ${repairedCount}`)
  }
  console.log(`─────────────────────────────────────────────────\n`)

  process.exit(issueCount > 0 && !REPAIR ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(2)
})
