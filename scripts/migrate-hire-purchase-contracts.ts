import dbConnect from "../lib/dbConnect"
import HirePurchaseContract from "../models/HirePurchaseContract"

// Legacy statuses that predate the validated contract state machine. "DEFAULTED"
// only ever meant "behind on payments" in practice (no repossession workflow
// existed yet), so it maps to the new DELINQUENT status.
const LEGACY_STATUS_MAP: Record<string, string> = {
  DEFAULTED: "DELINQUENT",
}

export async function migrateLegacyHirePurchaseContracts() {
  await dbConnect()

  console.log("[Migration] Starting legacy hire-purchase contract state-machine migration...")
  const contracts = await HirePurchaseContract.find({})
  let migratedCount = 0

  for (const contract of contracts) {
    let updated = false

    const legacyStatus = contract.status as string
    if (LEGACY_STATUS_MAP[legacyStatus]) {
      contract.status = LEGACY_STATUS_MAP[legacyStatus]
      updated = true
    }

    if (contract.version === undefined || contract.version === null) {
      contract.version = 0
      updated = true
    }

    if (!contract.timeline || contract.timeline.length === 0) {
      contract.timeline = [
        {
          fromState: null,
          toState: contract.status,
          actorType: "system",
          reason: "Legacy contract migrated to the validated hire-purchase contract state machine.",
          timestamp: contract.createdAt || new Date(),
        },
      ]
      updated = true
    }

    if (updated) {
      await contract.save()
      migratedCount++
    }
  }

  console.log(`[Migration] Completed hire-purchase contract migration. Processed ${contracts.length} contracts (${migratedCount} updated).`)
  return { totalContracts: contracts.length, migratedCount }
}

if (require.main === module) {
  migrateLegacyHirePurchaseContracts()
    .then((res) => {
      console.log("[Migration Success]", res)
      process.exit(0)
    })
    .catch((err) => {
      console.error("[Migration Error]", err)
      process.exit(1)
    })
}
