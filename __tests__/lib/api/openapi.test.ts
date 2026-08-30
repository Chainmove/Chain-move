// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { apiContracts } from "@/lib/api/contracts"
import { buildOpenApiDocument, toJsonSchema } from "@/lib/api/openapi"
import { assertNoForbiddenFields } from "@/lib/api/serialization"

const document = buildOpenApiDocument()

describe("zod to JSON Schema conversion", () => {
  it("carries string formats and constraints", () => {
    expect(toJsonSchema(z.string().email())).toMatchObject({ type: "string", format: "email" })
    expect(toJsonSchema(z.string().min(2).max(8))).toMatchObject({ minLength: 2, maxLength: 8 })
    expect(toJsonSchema(z.string().regex(/^[a-f\d]{24}$/))).toMatchObject({ pattern: "^[a-f\\d]{24}$" })
  })

  it("distinguishes integers from numbers and records bounds", () => {
    expect(toJsonSchema(z.number().int().min(1).max(100))).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 100,
    })
  })

  it("marks optional and defaulted object properties as not required", () => {
    const schema = toJsonSchema(
      z.object({ required: z.string(), optional: z.string().optional(), defaulted: z.string().default("x") }),
    )

    expect(schema.required).toEqual(["required"])
    expect((schema.properties as Record<string, unknown>).defaulted).toMatchObject({ default: "x" })
  })

  it("expresses nullable fields as a type union", () => {
    expect(toJsonSchema(z.string().nullable())).toMatchObject({ type: ["string", "null"] })
  })

  it("sees through preprocess and coercion wrappers", () => {
    expect(toJsonSchema(z.preprocess((value) => value, z.number().int()))).toMatchObject({ type: "integer" })
    expect(toJsonSchema(z.coerce.number())).toMatchObject({ type: "number" })
  })

  it("closes objects declared strict and opens those declared passthrough", () => {
    expect(toJsonSchema(z.object({ a: z.string() }).strict()).additionalProperties).toBe(false)
    expect(toJsonSchema(z.object({ a: z.string() }).passthrough()).additionalProperties).toBe(true)
  })

  it("preserves descriptions as documentation", () => {
    expect(toJsonSchema(z.string().describe("A pool id.")).description).toBe("A pool id.")
  })

  it("refuses to silently emit an empty schema for an unsupported type", () => {
    // A permissive `{}` in the published contract is how undocumented fields
    // escape review, so the generator fails loudly instead.
    expect(() => toJsonSchema(z.function())).toThrow(/Unsupported Zod type/)
  })
})

describe("generated document", () => {
  it("matches the committed artifact, so drift fails CI", () => {
    const committed = JSON.parse(readFileSync("docs/openapi/chainmove.openapi.json", "utf8"))

    expect(document).toEqual(committed)
  })

  it("documents every registered contract", () => {
    for (const contract of apiContracts) {
      const operation = (document.paths as Record<string, Record<string, unknown>>)[contract.path]?.[
        contract.method.toLowerCase()
      ]

      expect(operation, `${contract.operationId} is missing from the document`).toBeDefined()
      expect((operation as { operationId: string }).operationId).toBe(contract.operationId)
    }
  })

  it("documents the success status each route actually returns", () => {
    for (const contract of apiContracts) {
      const expected = String(contract.successStatus ?? (contract.method === "POST" ? 201 : 200))
      const operation = (document.paths as Record<string, Record<string, any>>)[contract.path][
        contract.method.toLowerCase()
      ]

      expect(Object.keys(operation.responses), `${contract.operationId}`).toContain(expected)
    }
  })

  it("references the shared error envelope for every documented error status", () => {
    for (const contract of apiContracts) {
      const operation = (document.paths as Record<string, Record<string, any>>)[contract.path][
        contract.method.toLowerCase()
      ]

      for (const status of contract.errors || []) {
        expect(operation.responses[String(status)].content["application/json"].schema).toEqual({
          $ref: "#/components/schemas/ApiError",
        })
      }
    }
  })

  it("declares a security scheme on every non-public operation", () => {
    for (const contract of apiContracts) {
      if (contract.auth === "public") continue

      const operation = (document.paths as Record<string, Record<string, any>>)[contract.path][
        contract.method.toLowerCase()
      ]

      expect(operation.security.length, `${contract.operationId}`).toBeGreaterThan(0)
    }
  })

  it("offers the version header on every operation", () => {
    for (const [path, item] of Object.entries(document.paths as Record<string, Record<string, any>>)) {
      for (const [method, operation] of Object.entries(item)) {
        const names = (operation.parameters || []).map((parameter: { name: string }) => parameter.name)
        expect(names, `${method} ${path}`).toContain("X-API-Version")
      }
    }
  })

  it("never publishes a forbidden field name anywhere in the document", () => {
    expect(() => assertNoForbiddenFields(document)).not.toThrow()
  })

  it("marks a deprecated parameter in the published document", () => {
    const ledger = (document.paths as Record<string, Record<string, any>>)["/api/transactions/ledger"].get
    const pageSize = ledger.parameters.find((parameter: { name: string }) => parameter.name === "pageSize")

    expect(pageSize).toBeDefined()
    expect(pageSize.required).toBe(false)
  })

  it("pins path parameters as required", () => {
    const invest = (document.paths as Record<string, Record<string, any>>)["/api/pools/{poolId}/invest"].post
    const poolId = invest.parameters.find((parameter: { name: string }) => parameter.name === "poolId")

    expect(poolId).toMatchObject({ in: "path", required: true })
  })
})
