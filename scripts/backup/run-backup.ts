#!/usr/bin/env node
import "dotenv/config"
import { resolve } from "path"
import mongoose from "mongoose"
import { performBackup, listBackups } from "../../lib/backup"
import type { BackupOptions } from "../../lib/backup/types"

function printUsage() {
  console.log(`
ChainMove Backup Tool

Usage:
  tsx scripts/backup/run-backup.ts [options]

Options:
  --backup-dir <path>     Backup directory (default: ./backups)
  --encryption-key <key>  Encryption key (required, or BACKUP_ENCRYPTION_KEY env)
  --key-version <ver>     Key version label (default: backup-v1)
  --retention-days <n>    Retention in days (default: 30)
  --collections <list>    Comma-separated collection names (default: all)
  --dry-run              Preview without writing files
  --list                 List existing backups
  --help                 Show this message

Environment:
  MONGODB_URI             MongoDB connection string (required)
  BACKUP_ENCRYPTION_KEY   Default encryption key (can override with --encryption-key)

Examples:
  tsx scripts/backup/run-backup.ts --encryption-key my-secret-key
  tsx scripts/backup/run-backup.ts --collections users,transactions --dry-run
  tsx scripts/backup/run-backup.ts --list
`)
}

function parseArgs(args: string[]): Partial<BackupOptions> & { list?: boolean; help?: boolean } {
  const result: Partial<BackupOptions> & { list?: boolean; help?: boolean } = {}

  for (let i = 2; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--backup-dir":
        result.backupDir = args[++i]
        break
      case "--encryption-key":
        result.encryptionKey = args[++i]
        break
      case "--key-version":
        result.keyVersion = args[++i]
        break
      case "--retention-days":
        result.retentionDays = parseInt(args[++i], 10)
        break
      case "--collections":
        result.collections = args[++i].split(",").map((c) => c.trim())
        break
      case "--dry-run":
        result.dryRun = true
        break
      case "--list":
        result.list = true
        break
      case "--help":
        result.help = true
        break
    }
  }

  return result
}

function log(message: string) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${message}`)
}

function logError(message: string) {
  const ts = new Date().toISOString()
  console.error(`[${ts}] ERROR: ${message}`)
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.help) {
    printUsage()
    process.exit(0)
  }

  const backupDir = resolve(args.backupDir || "./backups")

  if (args.list) {
    log("Listing existing backups...")
    const backups = await listBackups(backupDir)
    if (backups.length === 0) {
      log("No backups found.")
    } else {
      console.log("\nExisting backups:")
      for (const b of backups) {
        const date = new Date(b.createdAt).toLocaleString()
        console.log(`  ${b.backupId}  ${date}  ${b.totalDocuments} docs  ${b.collections.length} collections  env=${b.environment}`)
      }
      console.log()
    }
    process.exit(0)
  }

  const encryptionKey = args.encryptionKey || process.env.BACKUP_ENCRYPTION_KEY
  if (!encryptionKey) {
    logError("Encryption key is required. Use --encryption-key or set BACKUP_ENCRYPTION_KEY.")
    process.exit(1)
  }

  if (!process.env.MONGODB_URI) {
    logError("MONGODB_URI is required.")
    process.exit(1)
  }

  log("Connecting to database...")
  await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false })
  log("Connected.")

  try {
    log(`Starting backup to ${backupDir}...`)
    if (args.dryRun) {
      log("DRY RUN mode - no files will be written.")
    }

    const { manifest, backupPath } = await performBackup({
      backupDir,
      encryptionKey,
      keyVersion: args.keyVersion,
      retentionDays: args.retentionDays,
      collections: args.collections,
      dryRun: args.dryRun,
    })

    if (!args.dryRun) {
      log(`Backup complete: ${backupPath}`)
    } else {
      log("Dry run complete.")
    }

    log(`Backup ID: ${manifest.backupId}`)
    log(`Collections: ${manifest.collections.length}`)
    log(`Total documents: ${manifest.totalDocuments}`)
    log(`Total size: ${manifest.totalSizeBytes} bytes`)
    log(`Environment: ${manifest.environment}`)
    log(`Schema version: ${manifest.schemaVersion}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    logError(`Backup failed: ${msg}`)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
  }
}

main()
