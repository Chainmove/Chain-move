import { z } from "zod"

import { ApiErrorSchema, API_ERROR_CODES } from "@/lib/api/errors"
import { assertNoForbiddenFields } from "@/lib/api/serialization"
import { API_VERSIONS, CURRENT_API_VERSION, API_VERSION_HEADER } from "@/lib/api/versioning"
import { apiContracts, type ApiContract } from "@/lib/api/contracts"

export type JsonSchema = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/* Zod -> JSON Schema                                                          */
/* -------------------------------------------------------------------------- */

interface ZodDefLike {
  description?: string
  typeName?: string
  [key: string]: unknown
}

function def(schema: z.ZodTypeAny): ZodDefLike {
  return schema._def as unknown as ZodDefLike
}

/**
 * Strips wrappers that do not change the emitted JSON Schema shape
 * (`.optional()`, `.default()`, `.nullable()`, `z.preprocess`, `.catch()`,
 * `.brand()`, pipelines) down to the schema that carries the actual type.
 */
export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch
  ) {
    return unwrapSchema(def(schema).innerType as z.ZodTypeAny)
  }

  if (schema instanceof z.ZodEffects) {
    return unwrapSchema(def(schema).schema as z.ZodTypeAny)
  }

  if (schema instanceof z.ZodPipeline) {
    return unwrapSchema(def(schema).out as z.ZodTypeAny)
  }

  if (schema instanceof z.ZodBranded) {
    return unwrapSchema(def(schema).type as z.ZodTypeAny)
  }

  if (schema instanceof z.ZodLazy) {
    return unwrapSchema((def(schema).getter as () => z.ZodTypeAny)())
  }

  return schema
}

/** A field is optional when it may be omitted from the payload entirely. */
export function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodCatch) {
    return true
  }
  if (schema instanceof z.ZodEffects) return isOptionalSchema(def(schema).schema as z.ZodTypeAny)
  if (schema instanceof z.ZodPipeline) return isOptionalSchema(def(schema).in as z.ZodTypeAny)
  return false
}

function isNullableSchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodNullable) return true
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodCatch) {
    return isNullableSchema(def(schema).innerType as z.ZodTypeAny)
  }
  return false
}

function collectDescription(schema: z.ZodTypeAny): string | undefined {
  const own = def(schema).description
  if (own) return own

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch
  ) {
    return collectDescription(def(schema).innerType as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodEffects) return collectDescription(def(schema).schema as z.ZodTypeAny)

  return undefined
}

function defaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    return (def(schema).defaultValue as () => unknown)()
  }
  if (schema instanceof z.ZodEffects) return defaultValue(def(schema).schema as z.ZodTypeAny)
  return undefined
}

function stringConstraints(schema: z.ZodString): JsonSchema {
  const output: JsonSchema = { type: "string" }

  for (const check of def(schema).checks as Array<Record<string, unknown>>) {
    switch (check.kind) {
      case "email":
        output.format = "email"
        break
      case "url":
        output.format = "uri"
        break
      case "uuid":
        output.format = "uuid"
        break
      case "datetime":
        output.format = "date-time"
        break
      case "min":
        output.minLength = check.value
        break
      case "max":
        output.maxLength = check.value
        break
      case "length":
        output.minLength = check.value
        output.maxLength = check.value
        break
      case "regex":
        output.pattern = (check.regex as RegExp).source
        break
      default:
        break
    }
  }

  return output
}

function numberConstraints(schema: z.ZodNumber): JsonSchema {
  const output: JsonSchema = { type: "number" }

  for (const check of def(schema).checks as Array<Record<string, unknown>>) {
    switch (check.kind) {
      case "int":
        output.type = "integer"
        break
      case "min":
        if (check.inclusive) output.minimum = check.value
        else output.exclusiveMinimum = check.value
        break
      case "max":
        if (check.inclusive) output.maximum = check.value
        else output.exclusiveMaximum = check.value
        break
      case "multipleOf":
        output.multipleOf = check.value
        break
      default:
        break
    }
  }

  return output
}

/**
 * Converts a Zod schema into an OpenAPI 3.1 schema object.
 *
 * The generator is intentionally total: an unrecognized Zod type throws rather
 * than silently emitting `{}`, because a permissive schema in the published
 * contract is how undocumented fields escape review.
 */
export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const description = collectDescription(schema)
  const fallback = defaultValue(schema)
  const nullable = isNullableSchema(schema)
  const base = convert(unwrapSchema(schema))

  const output: JsonSchema = { ...base }
  if (description) output.description = description
  if (typeof fallback !== "undefined") output.default = fallback

  if (nullable && typeof output.type === "string") {
    output.type = [output.type, "null"]
  }

  return output
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodString) return stringConstraints(schema)
  if (schema instanceof z.ZodNumber) return numberConstraints(schema)
  if (schema instanceof z.ZodBigInt) return { type: "integer", format: "int64" }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" }
  if (schema instanceof z.ZodDate) return { type: "string", format: "date-time" }
  if (schema instanceof z.ZodNull) return { type: "null" }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) return {}

  if (schema instanceof z.ZodLiteral) {
    const value = def(schema).value
    return { const: value, type: jsonTypeOf(value) }
  }

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: [...(def(schema).values as string[])] }
  }

  if (schema instanceof z.ZodNativeEnum) {
    const values = Object.values(def(schema).values as Record<string, string | number>).filter(
      (value) => typeof value === "string" || typeof value === "number",
    )
    return { enum: values }
  }

  if (schema instanceof z.ZodArray) {
    const output: JsonSchema = { type: "array", items: toJsonSchema(def(schema).type as z.ZodTypeAny) }
    const minLength = def(schema).minLength as { value: number } | null
    const maxLength = def(schema).maxLength as { value: number } | null
    if (minLength) output.minItems = minLength.value
    if (maxLength) output.maxItems = maxLength.value
    return output
  }

  if (schema instanceof z.ZodTuple) {
    return {
      type: "array",
      prefixItems: (def(schema).items as z.ZodTypeAny[]).map((item) => toJsonSchema(item)),
    }
  }

  if (schema instanceof z.ZodRecord) {
    return {
      type: "object",
      additionalProperties: toJsonSchema(def(schema).valueType as z.ZodTypeAny),
    }
  }

  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      const child = value as z.ZodTypeAny
      properties[key] = toJsonSchema(child)
      if (!isOptionalSchema(child)) required.push(key)
    }

    const output: JsonSchema = {
      type: "object",
      properties,
      additionalProperties: def(schema).unknownKeys === "passthrough",
    }
    if (required.length) output.required = required

    return output
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    return {
      oneOf: [...(def(schema).options as z.ZodTypeAny[])].map((option) => toJsonSchema(option)),
      discriminator: { propertyName: def(schema).discriminator as string },
    }
  }

  if (schema instanceof z.ZodUnion) {
    const options = def(schema).options as z.ZodTypeAny[]
    // `.optional()` on a union surfaces here as an explicit undefined member,
    // which has no JSON Schema equivalent.
    const modelled = options.filter((option) => !(unwrapSchema(option) instanceof z.ZodUndefined))
    if (modelled.length === 1) return toJsonSchema(modelled[0])
    return { anyOf: modelled.map((option) => toJsonSchema(option)) }
  }

  if (schema instanceof z.ZodIntersection) {
    return {
      allOf: [
        toJsonSchema(def(schema).left as z.ZodTypeAny),
        toJsonSchema(def(schema).right as z.ZodTypeAny),
      ],
    }
  }

  throw new Error(
    `Unsupported Zod type in API contract: ${def(schema).typeName || schema.constructor.name}. ` +
      `Extend lib/api/openapi.ts before using it in a contract.`,
  )
}

function jsonTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  if (typeof value === "boolean") return "boolean"
  return undefined
}

/* -------------------------------------------------------------------------- */
/* Document assembly                                                           */
/* -------------------------------------------------------------------------- */

/** Extracts the object shape behind a query/params schema, unwrapping effects. */
function objectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  const unwrapped = unwrapSchema(schema)
  if (!(unwrapped instanceof z.ZodObject)) return null
  return (unwrapped as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodTypeAny>
}

function parametersFor(contract: ApiContract): unknown[] | undefined {
  const parameters: unknown[] = []

  const pathShape = contract.params ? objectShape(contract.params) : null
  if (pathShape) {
    for (const [name, schema] of Object.entries(pathShape)) {
      parameters.push({
        name,
        in: "path",
        required: true,
        description: collectDescription(schema),
        schema: toJsonSchema(schema),
      })
    }
  }

  const queryShape = contract.query ? objectShape(contract.query) : null
  if (queryShape) {
    for (const [name, schema] of Object.entries(queryShape)) {
      parameters.push({
        name,
        in: "query",
        required: !isOptionalSchema(schema),
        description: collectDescription(schema),
        deprecated: contract.deprecatedParameters?.includes(name) || undefined,
        schema: toJsonSchema(schema),
      })
    }
  }

  parameters.push({
    name: API_VERSION_HEADER,
    in: "header",
    required: false,
    description: `Pins the API version. Supported: ${API_VERSIONS.join(", ")}.`,
    schema: { type: "string", enum: [...API_VERSIONS] },
  })

  return parameters.length ? parameters : undefined
}

function securityFor(contract: ApiContract): unknown[] {
  switch (contract.auth) {
    case "public":
      return []
    case "webhook":
      return [{ webhookSignature: [] }]
    default:
      return [{ sessionCookie: [] }]
  }
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Validation failed or the request was malformed.",
  401: "Authentication is required.",
  403: "The caller is authenticated but not permitted.",
  404: "The resource does not exist, or the caller may not learn that it does.",
  409: "The request conflicts with current resource state.",
  415: "Unsupported request content type.",
  422: "The request was understood but could not be processed.",
  429: "Rate limit exceeded.",
  500: "Unexpected server error.",
  502: "An upstream provider rejected the request.",
  503: "Temporarily unavailable; the request may be retried.",
}

function responsesFor(contract: ApiContract) {
  const successStatus = String(contract.successStatus ?? (contract.method === "POST" ? 201 : 200))

  const responses: Record<string, unknown> = {
    [successStatus]: {
      description: contract.summary,
      headers: {
        [API_VERSION_HEADER]: {
          description: "API version that served the response.",
          schema: { type: "string" },
        },
        "X-Correlation-Id": {
          description: "Correlation id for tracing this request in server logs.",
          schema: { type: "string" },
        },
      },
      content: {
        [contract.responseContentType ?? "application/json"]:
          contract.responseContentType && contract.responseContentType !== "application/json"
            ? { schema: { type: "string", format: "binary" } }
            : {
                schema: toJsonSchema(contract.response),
                ...(contract.example ? { example: contract.example } : {}),
              },
      },
    },
  }

  for (const status of contract.errors || []) {
    responses[String(status)] = {
      description: ERROR_DESCRIPTIONS[status] || "Error",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
      },
    }
  }

  return responses
}

export function buildOpenApiDocument(contracts: ApiContract[] = apiContracts) {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const contract of contracts) {
    // Contract examples are published verbatim, so they get the same redaction
    // guarantee as runtime responses.
    if (contract.example) assertNoForbiddenFields(contract.example)
    assertNoForbiddenFields(toJsonSchema(contract.response))

    const operation: Record<string, unknown> = {
      operationId: contract.operationId,
      summary: contract.summary,
      description: contract.description,
      tags: [contract.tag],
      security: securityFor(contract),
      parameters: parametersFor(contract),
      responses: responsesFor(contract),
    }

    if (contract.body) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: toJsonSchema(contract.body),
            ...(contract.requestExample ? { example: contract.requestExample } : {}),
          },
        },
      }
    }

    if (contract.deprecation) {
      operation.deprecated = true
      operation["x-sunset"] = contract.deprecation.sunset
      operation["x-deprecated-since"] = contract.deprecation.since
      operation["x-migration-url"] = contract.deprecation.migrationUrl
      if (contract.deprecation.replacedBy) {
        operation["x-replaced-by"] = contract.deprecation.replacedBy
      }
    }

    paths[contract.path] = { ...(paths[contract.path] || {}), [contract.method.toLowerCase()]: operation }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ChainMove API",
      version: CURRENT_API_VERSION,
      description:
        "Contract-first API for the ChainMove mobility finance platform. " +
        "Generated from lib/api/contracts.ts — do not edit by hand.",
    },
    servers: [{ url: "https://example.invalid", description: "Placeholder; set per environment." }],
    tags: [...new Set(contracts.map((contract) => contract.tag))].sort().map((name) => ({ name })),
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "token" },
        webhookSignature: { type: "apiKey", in: "header", name: "x-paystack-signature" },
      },
      schemas: {
        ApiError: {
          ...toJsonSchema(ApiErrorSchema),
          description: "Standard error envelope returned by every ChainMove endpoint.",
        },
        ApiErrorCode: { type: "string", enum: [...API_ERROR_CODES] },
      },
    },
    paths,
  }
}
