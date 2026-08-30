# ChainMove Disaster Recovery Runbook

## Recovery Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | 24 hours | Daily encrypted backups |
| **RTO** (Recovery Time Objective) | 4 hours | From incident declaration to verified restore |
| **Backup Retention** | 30 days | Configurable via `--retention-days` |
| **Encryption** | AES-256-GCM | Key derived from `BACKUP_ENCRYPTION_KEY` |

---

## Prerequisites

- Node.js 18+ with `tsx` available
- Access to `MONGODB_URI` (source) and target database
- `BACKUP_ENCRYPTION_KEY` environment variable set
- Sufficient disk space in backup directory (default: `./backups`)

---

## Key Management

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | Source MongoDB connection string |
| `BACKUP_ENCRYPTION_KEY` | Yes | Symmetric key for AES-256-GCM encryption |
| `MONGODB_RESTORE_URI` | Restore only | Target database URI for restore operations |
| `MONGODB_DRILL_URI` | Drill only | Isolated database for drill runs |

### Key Rotation

1. Generate a new key and update `BACKUP_ENCRYPTION_KEY`
2. Run a backup with the new key: `BACKUP_ENCRYPTION_KEY=new-key npm run backup`
3. The key version in the manifest tracks which key encrypted the backup
4. Old backups remain decryptable with their original key

### Key Storage

- **Never** commit encryption keys to source control
- Use environment variables or a secrets manager
- Rotate keys quarterly or after any suspected compromise
- Maintain at least two valid keys during rotation windows

---

## Backup Operations

### Create a Backup

```bash
# Full backup
BACKUP_ENCRYPTION_KEY=your-key npm run backup

# Backup specific collections
BACKUP_ENCRYPTION_KEY=your-key npm run backup -- --collections users,transactions

# Dry run (preview without writing)
BACKUP_ENCRYPTION_KEY=your-key npm run backup -- --dry-run

# Custom retention and key version
BACKUP_ENCRYPTION_KEY=your-key npm run backup -- --retention-days 90 --key-version rotate-v2
```

### List Existing Backups

```bash
npm run backup:list
```

Output format: `backup-id  date  documents  collections  environment`

### Backup Manifest

Each backup includes `manifest.json` with:
- `backupId`: Unique identifier
- `createdAt`: ISO 8601 timestamp
- `schemaVersion`: Schema version at backup time
- `collections`: List with document counts, checksums, and index definitions
- `checksumSha256`: Overall integrity checksum
- `encryptionAlgorithm`: Always `aes-256-gcm`
- `encryptionKeyVersion`: Key version used

---

## Restore Operations

### Step 1: Verify Backup Integrity

```bash
BACKUP_ENCRYPTION_KEY=your-key npm run restore:verify -- --backup-path ./backups/backup-xxx
```

This checks:
- Manifest structure and validity
- All encrypted files exist and are readable
- Decryption succeeds with provided key
- Document counts match manifest
- Checksums match

### Step 2: Generate Confirmation Token

```bash
BACKUP_ENCRYPTION_KEY=your-key npm run restore:token -- --target-uri mongodb://host:27017/target-db
```

The token expires in 5 minutes. It encodes the target database name and timestamp.

### Step 3: Execute Restore

```bash
BACKUP_ENCRYPTION_KEY=your-key npm run restore \
  -- --backup-path ./backups/backup-xxx \
  --target-uri mongodb://host:27017/target-db \
  --confirm-token <token-from-step-2>
```

### Safety Mechanisms

1. **Unsafe target detection**: Refuses to restore to databases named `chainmove`, `production`, or `prod`
2. **Confirmation token**: Required for non-dry-run restores, expires in 5 minutes
3. **Dry run**: Preview what would be restored without changes
4. **Integrity checks**: Backup verified before import begins

### Restore Options

| Flag | Description |
|------|-------------|
| `--skip-indexes` | Skip index recreation |
| `--skip-migration-check` | Skip schema migration verification |
| `--dry-run` | Preview without changes |
| `--force-unsafe-target` | Override unsafe target protection |

---

## Restore Drill

Run a complete backup → verify → restore → verify cycle:

```bash
# Full drill with generated fixtures
BACKUP_ENCRYPTION_KEY=drill-key npm run backup:drill

# Drill with specific seed (reproducible)
BACKUP_ENCRYPTION_KEY=drill-key npm run backup:drill -- --fixture-seed 42

# Drill against a real backup
BACKUP_ENCRYPTION_KEY=your-key npm run backup:drill -- --real-backup ./backups/backup-xxx
```

The drill:
1. Seeds fixture data (or uses real backup)
2. Creates encrypted backup
3. Verifies backup integrity
4. Restores to isolated target
5. Verifies restored database
6. Reports pass/fail with collection details

---

## Incident Response

### Data Loss Scenario

1. **Declare incident** and note the timestamp
2. **Identify last good backup**: `npm run backup:list`
3. **Verify backup integrity**: `npm run restore:verify`
4. **Generate confirmation token** for target database
5. **Restore** with the verified backup
6. **Validate** restored data matches expected state
7. **Replay** any transactions from audit logs if possible
8. **Document** the incident timeline

### Corruption Scenario

1. **Stop writes** to affected collections immediately
2. **Create emergency backup** of current state (may be partially corrupted)
3. **Identify corruption source** from audit logs
4. **Restore** from last known good backup
5. **Reconcile** any transactions that occurred between backup and corruption

### Key Compromise

1. **Rotate** encryption key immediately
2. **Re-encrypt** all backups with new key
3. **Audit** access logs for unauthorized backup access
4. **Verify** no unauthorized restores occurred

---

## Verification Checklist

After any restore, verify:

- [ ] Document counts match manifest
- [ ] Indexes recreated correctly
- [ ] KYC documents accessible (if applicable)
- [ ] Financial ledger balances match
- [ ] User authentication working
- [ ] Audit log continuity intact
- [ ] No data corruption in critical collections

---

## Log Redaction

The backup/restore system never logs:
- Database credentials (URIs are redacted in output)
- Encryption keys
- KYC document contents
- Backup file URLs with embedded secrets

All log output uses timestamps and sanitized database names only.

---

## Schedule (Recommended)

| Task | Frequency | Command |
|------|-----------|---------|
| Full backup | Daily 02:00 UTC | `npm run backup` |
| Backup verification | Weekly | `npm run restore:verify` |
| Restore drill | Monthly | `npm run backup:drill` |
| Key rotation | Quarterly | See Key Management |
| Retention cleanup | Weekly | Automatic via `--retention-days` |
