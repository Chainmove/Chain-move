import { mkdirSync, writeFileSync } from "fs"
import { dirname } from "path"
import { z } from "zod"

import { apiContracts, ApiErrorSchema } from "@/lib/api/contracts"

type JsonSchema = Record<string, unknown>

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrap(schema._def.innerType)
  }
  if (schema instanceof z.ZodEffects) return unwrap(schema._def.schema)
  return schema
}

function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const unwrapped = unwrap(schema)
  if (unwrapped instanceof z.ZodString) return { type: "string" }
  if (unwrapped instanceof z.ZodNumber) return { type: "number" }
  if (unwrapped instanceof z.ZodBoolean) return { type: "boolean" }
  if (unwrapped instanceof z.ZodLiteral) return { enum: [unwrapped._def.value] }
  if (unwrapped instanceof z.ZodEnum) return { type: "string", enum: unwrapped._def.values }
  if (unwrapped instanceof z.ZodArray) return { type: "array", items: toJsonSchema(unwrapped._def.type) }
  if (unwrapped instanceof z.ZodRecord) return { type: "object", additionalProperties: true }
  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const [key, value] of Object.entries(shape)) {
      const child = value as z.ZodTypeAny
      properties[key] = toJsonSchema(child)
      if (!(child instanceof z.ZodOptional) && !(child instanceof z.ZodDefault)) required.push(key)
    }
    return {
      type: "object",
      properties,
      required: required.length ? required : undefined,
      additionalProperties: unwrapped._def.unknownKeys !== "strict",
    }
  }
  return { type: "object" }
}

const document = {
  openapi: "3.1.0",
  info: {
    title: "ChainMove API",
    version: "1.0.0",
  },
  servers: [{ url: "https://example.invalid" }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "chainmove_session" },
      webhookSignature: { type: "apiKey", in: "header", name: "x-paystack-signature" },
    },
    schemas: {
      ApiError: toJsonSchema(ApiErrorSchema),
      MoneyMinor: {
        type: "object",
        required: ["currency", "amountMinor"],
        properties: {
          currency: { type: "string", description: "ISO 4217 currency code." },
          amountMinor: { type: "integer", description: "Minor units such as kobo or cents." },
        },
      },
    },
  },
  paths: Object.fromEntries(
    apiContracts.map((contract) => [
      contract.path,
      {
        [contract.method.toLowerCase()]: {
          tags: [contract.tag],
          security:
            contract.auth === "public"
              ? []
              : contract.auth === "webhook"
                ? [{ webhookSignature: [] }]
                : [{ sessionCookie: [] }],
          parameters: contract.path.includes("{poolId}")
            ? [{ name: "poolId", in: "path", required: true, schema: { type: "string" } }]
            : undefined,
          requestBody: contract.request
            ? {
                required: true,
                content: {
                  "application/json": {
                    schema: toJsonSchema(contract.request),
                  },
                },
              }
            : undefined,
          responses: {
            "200": {
              description: "Success",
              content: { "application/json": { schema: toJsonSchema(contract.response) } },
            },
            ...(contract.errors || []).reduce<Record<string, unknown>>((acc, status) => {
              acc[String(status)] = {
                description: "Error",
                content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
              }
              return acc
            }, {}),
          },
        },
      },
    ]),
  ),
}

const target = "docs/openapi/chainmove.openapi.json"
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Generated ${target}`)
