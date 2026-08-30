#!/usr/bin/env node
import "dotenv/config"
import { resolve } from "path"
import { mkdir, writeFile, rm } from "fs/promises"
import mongoose from "mongoose"
import { performBackup, performRestore, verifyBackupIntegrity, verifyRestoredDatabase } from "../../lib/backup"
import { generateFixtures, type FixtureDataset } from "./generate-fixtures"

function printUsage() {
  console.log(`
ChainMove Restore Drill

Runs a complete backup → verify → restore → verify cycle using either:
  - Generated fixture data (default)
  - A real backup against an isolated test database

Usage:
  tsx scripts/backup/run-drill.ts [options]

Options:
  --fixture-seed <n>      Random seed for fixture generation (default: random)
  --real-backup <path>    Use a real backup instead of fixtures
  --target-uri <uri>      Isolated target database URI (default: MONGODB_URI)
  --encryption-key <key>  Encryption key (default: drill-test-key)
  --cleanup               Remove drill artifacts after success
  --verbose               Print detailed progress
  --help                  Show this message

Environment:
  MONGODB_URI             MongoDB connection string (for fixture seeding)
  MONGODB_DRILL_URI       Isolated drill target (overrides --target-uri)
  BACKUP_ENCRYPTION_KEY   Default encryption key

⚠  WARNING: This script creates and destroys data in the target database.
   Never point --target-uri at production.

Examples:
  tsx scripts/backup/run-drill.ts
  tsx scripts/backup/run-drill.ts --fixture-seed 42 --cleanup
  tsx scripts/backup/run-drill.ts --real-backup ./backups/backup-xxx --verbose
`)
}

function parseArgs(args: string[]) {
  const result: {
    fixtureSeed?: number
    realBackup?: string
    targetUri?: string
    encryptionKey?: string
    cleanup?: boolean
    verbose?: boolean
    help?: boolean
  } = {}

  for (let i = 2; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--fixture-seed":
        result.fixtureSeed = parseInt(args[++i], 10)
        break
      case "--real-backup":
        result.realBackup = args[++i]
        break
      case "--target-uri":
        result.targetUri = args[++i]
        break
      case "--encryption-key":
        result.encryptionKey = args[++i]
        break
      case "--cleanup":
        result.cleanup = true
        break
      case "--verbose":
        result.verbose = true
        break
      case "--help":
        result.help = true
        break
    }
  }

  return result
}

function log(message: string, verbose?: boolean) {
  if (!verbose) {
    console.log(`[${new Date().toISOString()}] ${message}`)
  }
}

function logVerbose(message: string, verbose?: boolean) {
  if (verbose) {
    console.log(`[${new Date().toISOString()}] [verbose] ${message}`)
  }
}

function logError(message: string) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`)
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.help) {
    printUsage()
    process.exit(0)
  }

  const targetUri = args.targetUri || process.env.MONGODB_DRILL_URI || process.env.MONGODB_URI
  if (!targetUri) {
    logError("Target URI is required. Set MONGODB_URI or MONGODB_DRILL_URI, or use --target-uri.")
    process.exit(1)
  }

  const encryptionKey = args.encryptionKey || process.env.BACKUP_ENCRYPTION_KEY || "drill-test-key"
  const drillDir = resolve("./backups/.drill")
  const seed = args.fixtureSeed ?? Math.floor(Math.random() * 100000)

  let fixtureDataset: FixtureDataset | null = null
  let success = false

  try {
    console.log("\n=== ChainMove Restore Drill ===\n")
    console.log(`Target database: ${targetUri.replace(/\/\/.*@/, "//***@")}`)
    console.log(`Fixture seed: ${seed}`)
    console.log()

    if (args.realBackup) {
      log(`Phase 1: Verifying real backup integrity...`)
      const verifyResult = await verifyBackupIntegrity(args.realBackup, encryptionKey)
      if (!verifyResult.valid) {
        logError("Backup verification failed. Aborting drill.")
        for (const err of verifyResult.errors) {
          console.error(`  - ${err}`)
        }
        process.exit(1)
      }
      log("Backup verification PASSED.")
    }

    log("Phase 2: Connecting to source database...")
    await mongoose.connect(process.env.MONGODB_URI || targetUri, { bufferCommands: false })
    log("Connected to source.")

    if (!args.realBackup) {
      log("Phase 3: Seeding fixture data...")
      fixtureDataset = await generateFixtures(mongoose.connection.db as any, seed)
      log(`Seeded ${fixtureDataset.collectionCount} collections, ${fixtureDataset.documentCount} documents.`)
    }

    log("Phase 4: Creating encrypted backup...")
    await mkdir(drillDir, { recursive: true })
    const { manifest, backupPath } = await performBackup({
      backupDir: drillDir,
      encryptionKey,
      keyVersion: `drill-v${seed}`,
      retentionDays: 1,
    })
    log(`Backup created: ${manifest.backupId} (${manifest.totalDocuments} docs)`)

    log("Phase 5: Verencing backup integrity...")
    const integrity = await verifyBackupIntegrity(backupPath, encryptionKey)
    if (!integrity.valid) {
      logError("Backup integrity check failed!")
      for (const err of integrity.errors) {
        console.error(`  - ${err}`)
      }
      process.exit(1)
    }
    log("Integrity check PASSED.")

    log("Phase 6: Restoring to isolated target...")
    await mongoose.disconnect()
    const token = `drill-confirm:${seed}:${Date.now()}`

    const restoreResult = await performRestore({
      backupPath,
      targetUri,
      encryptionKey,
      confirmationToken: token,
      skipMigrationCheck: false,
    })
    log(restoreResult.message)

    log("Phase 7: Verifying restored database...")
    const dbVerify = await verifyRestoredDatabase(targetUri, manifest)

    if (dbVerify.valid) {
      log("Restored database verification PASSED.")
    } else {
      logError("Restored database verification FAILED.")
      for (const err of dbVerify.errors) {
        console.error(`  - ${err}`)
      }
    }

    if (dbVerify.warnings.length > 0) {
      console.log("\nWarnings:")
      for (const w of dbVerify.warnings) {
        console.log(`  - ${w}`)
      }
    }

    console.log("\nCollection verification:")
    for (const [name, info] of Object.entries(dbVerify.collectionResults)) {
      const countStatus = info.countMatch ? "OK" : "FAIL"
      const indexStatus = info.indexMatch ? "OK" : "WARN"
      console.log(`  ${name}: count=${countStatus} (${info.documentCount}/${info.expectedCount}), indexes=${indexStatus}`)
    }

    success = dbVerify.valid

    if (success) {
      console.log("\n=== Drill PASSED ===\n")
    } else {
      console.log("\n=== Drill FAILED ===\n")
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    logError(`Drill failed: ${msg}`)
    success = false
  } finally {
    if (args.cleanup || success) {
      try {
        await rm(drillDir, { recursive: true, force: true })
        logVerbose("Cleaned up drill artifacts.", args.verbose)
      } catch {
        // Non-critical
      }
    }

    try {
      await mongoose.disconnect()
    } catch {
      // Already disconnected
    }
  }

  process.exit(success ? 0 : 1)
}

main()
