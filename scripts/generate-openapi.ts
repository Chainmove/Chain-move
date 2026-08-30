import { mkdirSync, writeFileSync } from "fs"
import { dirname } from "path"

import { buildOpenApiDocument } from "@/lib/api/openapi"

const target = "docs/openapi/chainmove.openapi.json"

const document = buildOpenApiDocument()

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)

console.log(`Generated ${target} (${Object.keys(document.paths).length} paths)`)
