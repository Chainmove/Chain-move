import { readFileSync } from "fs"
import { execFileSync } from "child_process"

const target = "docs/openapi/chainmove.openapi.json"
const before = readFileSync(target, "utf8")
execFileSync("npx", ["tsx", "scripts/generate-openapi.ts"], { stdio: "inherit" })
const after = readFileSync(target, "utf8")

if (before !== after) {
  throw new Error("OpenAPI contract drift detected. Run npm run openapi:generate and commit the result.")
}

console.log("OpenAPI contract is up to date.")
