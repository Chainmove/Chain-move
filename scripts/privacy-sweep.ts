/**
 * CLI entry point for the periodic privacy sweep. Invoked by cron, e.g.
 *
 *   tsx scripts/privacy-sweep.ts
 */

import { runPrivacySweep } from "@/lib/privacy/privacy-sweep"

async function main() {
  const report = await runPrivacySweep()
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error("PRIVACY_SWEEP_ERROR", error)
  process.exit(1)
})
