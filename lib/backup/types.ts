import type { ObjectId } from "mongoose"

export type BackupManifest = {
  version: 2
  backupId: string
  createdAt: string
  appVersion: string
  schemaVersion: string
  databaseName: string
  collections: CollectionInfo[]
  totalDocuments: number
  totalSizeBytes: number
  checksumSha256: string
  encryptionAlgorithm: string
  encryptionKeyVersion: string
  retentionDays: number
  environment: string
}

export type CollectionInfo = {
  name: string
  documentCount: number
  indexes: IndexInfo[]
  checksumSha256: string
}

export type IndexInfo = {
  name: string
  key: Record<string, 1 | -1 | "2dsphere" | string>
  unique?: boolean
  sparse?: boolean
  expireAfterSeconds?: number
}

export type BackupOptions = {
  backupDir: string
  encryptionKey: string
  keyVersion?: string
  retentionDays?: number
  collections?: string[]
  dryRun?: boolean
}

export type RestoreOptions = {
  backupPath: string
  targetUri: string
  encryptionKey: string
  confirmationToken?: string
  skipIndexes?: boolean
  skipMigrationCheck?: boolean
  dryRun?: boolean
}

export type DrillOptions = {
  fixtureSeed?: number
  backupDir: string
  encryptionKey: string
  skipVerification?: boolean
}

export type VerifyResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  collectionResults: Record<string, CollectionVerifyResult>
}

export type CollectionVerifyResult = {
  documentCount: number
  expectedCount: number
  countMatch: boolean
  indexCount: number
  expectedIndexCount: number
  indexMatch: boolean
  checksumMatch: boolean
}

export const DEFAULT_BACKUP_COLLECTIONS = [
  "users",
  "vehicles",
  "loans",
  "investments",
  "transactions",
  "exchangeratequotes",
  "driverpayments",
  "drivervirtualaccounts",
  "investorvirtualaccounts",
  "investorcredits",
  "investmentpools",
  "poolinvestments",
  "hirepurchasecontracts",
  "notifications",
  "issues",
  "auditlogs",
  "platformsettings",
  "processedgatewayevents",
  "kycdocuments",
  "privacyrequests",
  "stellarpoolassets",
  "stellarindexedevents",
  "stellarindexercursors",
]

export const UNSAFE_TARGET_PATTERNS = [
  /mongodb(\+srv)?:\/\/.*\/chainmove$/i,
  /mongodb(\+srv)?:\/\/.*\/production$/i,
  /mongodb(\+srv)?:\/\/.*\/prod$/i,
]

export const CONFIRMATION_TOKEN_PREFIX = "restore-confirm:"
export const RESTORE_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000
