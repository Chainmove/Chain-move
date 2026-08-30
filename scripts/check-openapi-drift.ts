import { readFileSync } from "fs"
import { execFileSync } from "child_process"
import { createRequire } from "module"
import { dirname, resolve } from "path"

const target = "docs/openapi/chainmove.openapi.json"
const require = createRequire(import.meta.url)
const tsxPackageRoot = dirname(require.resolve("tsx/package.json"))
const tsxCli = resolve(tsxPackageRoot, "dist/cli.mjs")
const before = readFileSync(target, "utf8")
execFileSync(process.execPath, [tsxCli, "scripts/generate-openapi.ts"], { stdio: "inherit" })
const after = readFileSync(target, "utf8")

if (before !== after) {
  throw new Error("OpenAPI contract drift detected. Run npm run openapi:generate and commit the result.")
}

console.log("OpenAPI contract is up to date.")
