import { readFileSync } from "fs"

const current = JSON.parse(readFileSync("docs/openapi/chainmove.openapi.json", "utf8"))
const fixture = JSON.parse(readFileSync("docs/openapi/fixtures/breaking-change.previous.json", "utf8"))

function assertNoBreakingRemoval(previousDoc: any, currentDoc: any) {
  for (const [path, methods] of Object.entries(previousDoc.paths || {})) {
    if (!currentDoc.paths?.[path]) {
      throw new Error(`Breaking API change: removed path ${path}`)
    }
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      if (!currentDoc.paths[path]?.[method]) {
        throw new Error(`Breaking API change: removed method ${method.toUpperCase()} ${path}`)
      }
    }
  }
}

try {
  assertNoBreakingRemoval(fixture, current)
  console.log("OpenAPI compatibility check passed.")
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
