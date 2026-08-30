#!/usr/bin/env node
import "dotenv/config"
import { resolve } from "path"
import { performRestore, generateConfirmationToken, verifyBackupIntegrity } from "../../lib/backup"
import type { RestoreOptions } from "../../lib/backup/types"

function printUsage() {
  console.log(`
ChainMove Restore Tool

Usage:
  tsx scripts/backup/run-restore.ts [options]

Options:
  --backup-path <path>    Path to backup directory (required)
  --target-uri <uri>      Target MongoDB URI (required, or MONGODB_RESTORE_URI env)
  --encryption-key <key>  Encryption key (required, or BACKUP_ENCRYPTION_KEY env)
  --confirm-token <token> Confirmation token (generate first, then paste)
  --generate-token        Generate a confirmation token for the target
  --skip-indexes          Skip index recreation
  --skip-migration-check  Skip schema migration verification
  --verify-only           Verify backup integrity without restoring
  --dry-run               Preview without making changes
  --force-unsafe-target   Override unsafe target detection (DANGEROUS)
  --help                  Show this message

Safety:
  By default, the tool refuses to restore to databases named "chainmove" or
  "production" to prevent accidental overwrites. Use --force-unsafe-target
  only when you are certain.

  The tool requires a confirmation token that expires in 5 minutes. Generate
  one with --generate-token, then pass it with --confirm-token.

Steps:
  1. Generate token:  tsx scripts/backup/run-restore.ts --generate-token --target-uri <uri>
  2. Verify backup:  tsx scripts/backup/run-restore.ts --verify-only --backup-path <path> --encryption-key <key>
  3. Restore:        tsx scripts/backup/run-restore.ts --backup-path <path> --target-uri <uri> --encryption-key <key> --confirm-token <token>

Environment:
  MONGODB_RESTORE_URI    Target MongoDB URI (can override with --target-uri)
  BACKUP_ENCRYPTION_KEY  Encryption key (can override with --encryption-key)
`)
}

function parseArgs(args: string[]) {
  const result: Partial<RestoreOptions & {
    generateToken?: boolean
    verifyOnly?: boolean
    forceUnsafeTarget?: boolean
    help?: boolean
  }> = {}

  for (let i = 2; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--backup-path":
        result.backupPath = args[++i]
        break
      case "--target-uri":
        result.targetUri = args[++i]
        break
      case "--encryption-key":
        result.encryptionKey = args[++i]
        break
      case "--confirm-token":
        result.confirmationToken = args[++i]
        break
      case "--skip-indexes":
        result.skipIndexes = true
        break
      case "--skip-migration-check":
        result.skipMigrationCheck = true
        break
      case "--verify-only":
        result.verifyOnly = true
        break
      case "--dry-run":
        result.dryRun = true
        break
      case "--force-unsafe-target":
        result.forceUnsafeTarget = true
        break
      case "--generate-token":
        result.generateToken = true
        break
      case "--help":
        result.help = true
        break
    }
  }

  return result
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`)
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

  if (args.generateToken) {
    const targetUri = args.targetUri || process.env.MONGODB_RESTORE_URI
    if (!targetUri) {
      logError("Target URI is required for token generation.")
      process.exit(1)
    }
    const token = generateConfirmationToken(targetUri)
    console.log(`\nConfirmation token (expires in 5 minutes):\n  ${token}\n`)
    process.exit(0)
  }

  const backupPath = args.backupPath ? resolve(args.backupPath) : undefined
  const targetUri = args.targetUri || process.env.MONGODB_RESTORE_URI
  const encryptionKey = args.encryptionKey || process.env.BACKUP_ENCRYPTION_KEY

  if (!backupPath) {
    logError("--backup-path is required.")
    process.exit(1)
  }

  if (!encryptionKey) {
    logError("Encryption key is required. Use --encryption-key or set BACKUP_ENCRYPTION_KEY.")
    process.exit(1)
  }

  if (args.verifyOnly) {
    log(`Verifying backup integrity: ${backupPath}`)
    const result = await verifyBackupIntegrity(backupPath, encryptionKey)

    if (result.valid) {
      log("Backup verification PASSED.")
    } else {
      logError("Backup verification FAILED.")
      for (const err of result.errors) {
        console.error(`  - ${err}`)
      }
    }

    if (result.warnings.length > 0) {
      console.log("\nWarnings:")
      for (const warn of result.warnings) {
        console.log(`  - ${warn}`)
      }
    }

    console.log("\nCollection details:")
    for (const [name, info] of Object.entries(result.collectionResults)) {
      const status = info.countMatch && info.checksumMatch ? "OK" : "FAIL"
      console.log(`  ${name}: ${status} (${info.documentCount}/${info.expectedCount} docs, checksum=${info.checksumMatch ? "match" : "mismatch"})`)
    }

    process.exit(result.valid ? 0 : 1)
  }

  if (!targetUri) {
    logError("--target-uri or MONGODB_RESTORE_URI is required.")
    process.exit(1)
  }

  if (!args.confirmationToken && !args.dryRun) {
    logError("Confirmation token required. Generate one first with --generate-token.")
    process.exit(1)
  }

  log(`Restoring from: ${backupPath}`)
  log(`Target: ${targetUri.replace(/\/\/.*@/, "//***@")}`)

  try {
    const result = await performRestore({
      backupPath,
      targetUri,
      encryptionKey,
      confirmationToken: args.confirmationToken,
      skipIndexes: args.skipIndexes,
      skipMigrationCheck: args.skipMigrationCheck,
      dryRun: args.dryRun,
    })

    if (result.success) {
      log(result.message)
    } else {
      logError(result.message)
      process.exit(1)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    logError(`Restore failed: ${msg}`)
    process.exit(1)
  }
}

main()
