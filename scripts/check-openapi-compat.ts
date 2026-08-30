import { existsSync, readFileSync } from "fs"

import { compareOpenApiDocuments, evaluateCompatibility, type ApprovedBreakingChange } from "@/lib/api/compat"

const CURRENT = "docs/openapi/chainmove.openapi.json"
const BASELINE = "docs/openapi/baseline.openapi.json"
const APPROVALS = "docs/openapi/approved-breaking-changes.json"

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, "utf8")) as T
}

const current = JSON.parse(readFileSync(CURRENT, "utf8"))

if (!existsSync(BASELINE)) {
  console.error(
    `Missing ${BASELINE}. Create it by copying the released contract:\n` +
      `  cp ${CURRENT} ${BASELINE}`,
  )
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"))
const approvals = readJson<{ changes: ApprovedBreakingChange[] }>(APPROVALS, { changes: [] })

const changes = compareOpenApiDocuments(baseline, current)
const result = evaluateCompatibility(changes, approvals.changes || [])

for (const change of result.approved) {
  console.log(`approved breaking change: ${change.operation} — ${change.detail}`)
}

if (result.staleApprovals.length) {
  console.warn(
    `\n${result.staleApprovals.length} approval(s) in ${APPROVALS} no longer match a detected change ` +
      `and should be removed:`,
  )
  for (const approval of result.staleApprovals) {
    console.warn(`  - ${approval.id}`)
  }
}

if (result.breaking.length) {
  console.error(`\nBreaking API changes detected (${result.breaking.length}):\n`)

  for (const change of result.breaking) {
    console.error(`  ${change.operation}`)
    console.error(`    ${change.detail}`)
    console.error(`    approval id: ${change.id}\n`)
  }

  console.error(
    `Either revert the change, or record it in ${APPROVALS} with a reason and a migration link:\n\n` +
      JSON.stringify(
        {
          changes: [
            {
              id: result.breaking[0].id,
              reason: "Why this break is necessary.",
              migrationUrl: "docs/api-migration.md#section",
              approvedOn: new Date().toISOString().slice(0, 10),
            },
          ],
        },
        null,
        2,
      ) +
      `\n\nThen update the baseline once released: cp ${CURRENT} ${BASELINE}`,
  )

  process.exit(1)
}

console.log(
  `\nOpenAPI compatibility check passed ` +
    `(${result.additive.length} additive change(s), ${result.approved.length} approved breaking change(s)).`,
)
