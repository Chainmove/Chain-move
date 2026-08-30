/**
 * Backfills the deprecated embedded `User.notifications` array into the
 * Notification collection and unsets it, leaving one authoritative store for
 * notification content and read state.
 *
 * Usage:
 *   bun run notifications:migrate-embedded -- --dry-run
 *   bun run notifications:migrate-embedded
 *
 * The mapping is deterministic, so re-running after a partial failure resumes
 * without duplicating feed entries.
 */
import { migrateEmbeddedNotifications } from "../lib/notifications/embedded-migration"

const dryRun = process.argv.includes("--dry-run")

async function main() {
  const result = await migrateEmbeddedNotifications({ dryRun })

  // JSON keeps the migration inventory machine-readable in deployment logs and
  // carries no notification bodies or owner identifiers.
  process.stdout.write(`${JSON.stringify({ ...result, dryRun, at: new Date().toISOString() }, null, 2)}\n`)

  if (result.errors.length > 0) {
    process.stderr.write(`${result.errors.length} user(s) failed to migrate; re-run to retry.\n`)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Embedded notification migration failed"}\n`)
    process.exit(1)
  })
