#!/usr/bin/env tsx

import dbConnect from "@/lib/dbConnect"
import { getStellarConfig, parseStellarNetwork } from "@/lib/stellar/config"
import StellarIndexedEvent, { buildStellarIndexedEventId } from "@/models/StellarIndexedEvent"
import StellarRawEvent from "@/models/StellarRawEvent"

interface Options {
  apply: boolean
  network?: string
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--apply") options.apply = true
    if (arg === "--network") options.network = argv[++i]
  }
  return options
}

function inferOperationId(doc: any): string {
  return String(doc.operationId || doc.raw?.id || doc._id)
}

async function resolveLegacyNetwork(operationId: string, fallbackNetwork?: string): Promise<{ network?: string; reason?: string }> {
  const rawMatches = await StellarRawEvent.find({ operationId }).select("network").lean()
  const networks = [...new Set(rawMatches.map((match: any) => String(match.network || "").toLowerCase()).filter(Boolean))]

  if (networks.length === 1) return { network: networks[0] }
  if (networks.length > 1) return { reason: `ambiguous raw provenance: ${networks.join(",")}` }
  if (fallbackNetwork) return { network: parseStellarNetwork(fallbackNetwork) }

  return { reason: "legacy projection has no raw network provenance" }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const configuredNetwork = options.network ?? getStellarConfig().network

  await dbConnect()

  const legacyEvents = await StellarIndexedEvent.find({
    $or: [
      { network: { $exists: false } },
      { operationId: { $exists: false } },
      { _id: { $not: /^(testnet|mainnet):/ } },
    ],
  }).lean()

  let backfilled = 0
  let quarantined = 0

  for (const event of legacyEvents) {
    const operationId = inferOperationId(event)
    const resolution = await resolveLegacyNetwork(operationId, configuredNetwork)

    if (!resolution.network) {
      quarantined++
      if (options.apply) {
        await StellarIndexedEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              operationId,
              projectionStatus: "quarantined",
              projectionProvenance: "legacy_quarantine",
              quarantineReason: resolution.reason,
            },
          },
        )
      }
      continue
    }

    backfilled++
    if (options.apply) {
      const nextId = buildStellarIndexedEventId(resolution.network, operationId)
      await StellarIndexedEvent.replaceOne(
        { _id: event._id },
        {
          ...event,
          _id: nextId,
          network: resolution.network,
          operationId,
          projectionStatus: "active",
          projectionProvenance: "legacy_backfill",
        },
        { upsert: true },
      )
      if (nextId !== String(event._id)) {
        await StellarIndexedEvent.deleteOne({ _id: event._id })
      }
    }
  }

  console.log(JSON.stringify({ scanned: legacyEvents.length, backfilled, quarantined, dryRun: !options.apply }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
