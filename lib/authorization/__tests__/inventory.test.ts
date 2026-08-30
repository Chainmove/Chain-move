// @vitest-environment node
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ROUTE_POLICY_INVENTORY } from "../inventory"

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routeFiles(path.join(directory, entry.name)) : entry.name === "route.ts" ? [path.join(directory, entry.name)] : [])
}
function routeKey(file: string, method: string) {
  const relative = path.relative(path.join(process.cwd(), "app", "api"), file).replaceAll("\\", "/").replace(/\/route\.ts$/, "")
  return `${method} /api/${relative}`
}

describe("route policy inventory", () => {
  it("denies undeclared API handlers by default", () => {
    // Handlers are declared either directly (`export async function GET`) or
    // through the shared contract wrapper (`export const GET = defineRoute`).
    const discovered = routeFiles(path.join(process.cwd(), "app", "api")).flatMap(file => [...fs.readFileSync(file, "utf8").matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map(match => routeKey(file, match[1])))
    expect(discovered.filter(key => !ROUTE_POLICY_INVENTORY[key])).toEqual([])
    expect(Object.keys(ROUTE_POLICY_INVENTORY).filter(key => !discovered.includes(key))).toEqual([])
  })
  it("requires every non-public handler to declare a typed action", () => {
    for (const entry of Object.values(ROUTE_POLICY_INVENTORY)) if (entry.access !== "public") expect(entry.action).toMatch(/^[a-z]+(?::[a-z]+)+$/)
  })
})
