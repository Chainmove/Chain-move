/**
 * Structural compatibility checking between two generated OpenAPI documents.
 *
 * The rules are variance-aware, which is what makes the result trustworthy:
 * request schemas are inputs (contravariant) and response schemas are outputs
 * (covariant), so the same edit can be safe in one position and breaking in the
 * other. Widening what the server accepts is safe; widening what it returns is
 * not.
 */

export type ChangeKind = "breaking" | "additive"

export interface CompatChange {
  kind: ChangeKind
  /** Stable identifier used to approve a change in the exceptions file. */
  id: string
  operation: string
  pointer: string
  detail: string
}

type JsonSchema = Record<string, any>
type OpenApiDocument = Record<string, any>

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const

export function compareOpenApiDocuments(previous: OpenApiDocument, current: OpenApiDocument): CompatChange[] {
  const changes: CompatChange[] = []

  for (const [path, previousItem] of Object.entries(previous.paths || {})) {
    const currentItem = current.paths?.[path]

    if (!currentItem) {
      changes.push({
        kind: "breaking",
        id: `removed-path ${path}`,
        operation: path,
        pointer: "",
        detail: `Path ${path} was removed.`,
      })
      continue
    }

    for (const method of HTTP_METHODS) {
      const previousOperation = (previousItem as JsonSchema)[method]
      if (!previousOperation) continue

      const operationLabel = `${method.toUpperCase()} ${path}`
      const currentOperation = currentItem[method]

      if (!currentOperation) {
        changes.push({
          kind: "breaking",
          id: `removed-operation ${operationLabel}`,
          operation: operationLabel,
          pointer: "",
          detail: `Operation ${operationLabel} was removed.`,
        })
        continue
      }

      compareSecurity(previousOperation, currentOperation, operationLabel, changes)
      compareParameters(previousOperation, currentOperation, operationLabel, changes)
      compareRequestBody(previousOperation, currentOperation, operationLabel, changes)
      compareResponses(previousOperation, currentOperation, operationLabel, changes)
    }
  }

  return changes
}

/* -------------------------------------------------------------------------- */
/* Operation-level comparisons                                                 */
/* -------------------------------------------------------------------------- */

function compareSecurity(
  previous: JsonSchema,
  current: JsonSchema,
  operation: string,
  changes: CompatChange[],
) {
  const previousSchemes = securityNames(previous)
  const currentSchemes = securityNames(current)

  // Requiring authentication where none was required breaks anonymous callers.
  for (const scheme of currentSchemes) {
    if (!previousSchemes.includes(scheme)) {
      changes.push({
        kind: "breaking",
        id: `added-security ${operation} ${scheme}`,
        operation,
        pointer: "security",
        detail: `Operation now requires security scheme "${scheme}".`,
      })
    }
  }
}

function securityNames(operation: JsonSchema): string[] {
  const security = Array.isArray(operation.security) ? operation.security : []
  return security.flatMap((entry: JsonSchema) => Object.keys(entry || {}))
}

function compareParameters(
  previous: JsonSchema,
  current: JsonSchema,
  operation: string,
  changes: CompatChange[],
) {
  const previousParameters = indexParameters(previous)
  const currentParameters = indexParameters(current)

  for (const [key, previousParameter] of previousParameters) {
    const currentParameter = currentParameters.get(key)

    if (!currentParameter) {
      changes.push({
        kind: "breaking",
        id: `removed-parameter ${operation} ${key}`,
        operation,
        pointer: `parameters.${key}`,
        detail: `Parameter "${key}" was removed.`,
      })
      continue
    }

    if (!previousParameter.required && currentParameter.required) {
      changes.push({
        kind: "breaking",
        id: `required-parameter ${operation} ${key}`,
        operation,
        pointer: `parameters.${key}`,
        detail: `Parameter "${key}" is now required.`,
      })
    }

    compareSchema(
      previousParameter.schema || {},
      currentParameter.schema || {},
      { operation, pointer: `parameters.${key}`, variance: "request" },
      changes,
    )
  }

  for (const [key, currentParameter] of currentParameters) {
    if (previousParameters.has(key)) continue
    if (currentParameter.required) {
      changes.push({
        kind: "breaking",
        id: `new-required-parameter ${operation} ${key}`,
        operation,
        pointer: `parameters.${key}`,
        detail: `New required parameter "${key}" was added.`,
      })
    }
  }
}

function indexParameters(operation: JsonSchema): Map<string, JsonSchema> {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : []
  return new Map(parameters.map((parameter: JsonSchema) => [`${parameter.in}:${parameter.name}`, parameter]))
}

function compareRequestBody(
  previous: JsonSchema,
  current: JsonSchema,
  operation: string,
  changes: CompatChange[],
) {
  const previousSchema = bodySchema(previous)
  const currentSchema = bodySchema(current)

  if (!previousSchema) return

  if (!currentSchema) {
    changes.push({
      kind: "breaking",
      id: `removed-request-body ${operation}`,
      operation,
      pointer: "requestBody",
      detail: "Request body schema was removed.",
    })
    return
  }

  compareSchema(previousSchema, currentSchema, { operation, pointer: "requestBody", variance: "request" }, changes)
}

function bodySchema(operation: JsonSchema): JsonSchema | undefined {
  return operation.requestBody?.content?.["application/json"]?.schema
}

function compareResponses(
  previous: JsonSchema,
  current: JsonSchema,
  operation: string,
  changes: CompatChange[],
) {
  for (const [status, previousResponse] of Object.entries(previous.responses || {})) {
    const currentResponse = current.responses?.[status]

    if (!currentResponse) {
      changes.push({
        kind: "breaking",
        id: `removed-response ${operation} ${status}`,
        operation,
        pointer: `responses.${status}`,
        detail: `Documented response status ${status} was removed.`,
      })
      continue
    }

    const previousSchema = (previousResponse as JsonSchema)?.content?.["application/json"]?.schema
    const currentSchema = (currentResponse as JsonSchema)?.content?.["application/json"]?.schema
    if (!previousSchema || !currentSchema) continue

    compareSchema(
      previousSchema,
      currentSchema,
      { operation, pointer: `responses.${status}`, variance: "response" },
      changes,
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Schema comparison                                                           */
/* -------------------------------------------------------------------------- */

interface CompareContext {
  operation: string
  pointer: string
  variance: "request" | "response"
}

function compareSchema(
  previous: JsonSchema,
  current: JsonSchema,
  context: CompareContext,
  changes: CompatChange[],
  depth = 0,
) {
  // Guards against a self-referential schema pair looping forever.
  if (depth > 25) return

  // `$ref` targets are shared components; equality of the ref is sufficient.
  if (previous.$ref || current.$ref) {
    if (previous.$ref !== current.$ref) {
      push(changes, "breaking", context, `Schema reference changed from ${previous.$ref} to ${current.$ref}.`, "ref")
    }
    return
  }

  compareTypes(previous, current, context, changes)
  compareEnums(previous, current, context, changes)

  if (previous.properties || current.properties) {
    compareProperties(previous, current, context, changes, depth)
  }

  if (previous.items && current.items) {
    compareSchema(previous.items, current.items, { ...context, pointer: `${context.pointer}[]` }, changes, depth + 1)
  }
}

function compareTypes(
  previous: JsonSchema,
  current: JsonSchema,
  context: CompareContext,
  changes: CompatChange[],
) {
  const previousTypes = normalizeTypes(previous.type)
  const currentTypes = normalizeTypes(current.type)

  if (!previousTypes.length || !currentTypes.length) return
  if (setsEqual(previousTypes, currentTypes)) return

  if (context.variance === "response") {
    // A response may narrow (drop `null`) but not introduce a type a client
    // was never told to expect.
    const added = currentTypes.filter((type) => !previousTypes.includes(type))
    if (added.length) {
      push(changes, "breaking", context, `Response type widened to include ${added.join(", ")}.`, "type")
    }
    return
  }

  // A request may accept more types than before, but dropping one rejects
  // payloads that used to succeed.
  const removed = previousTypes.filter((type) => !currentTypes.includes(type))
  if (removed.length) {
    push(changes, "breaking", context, `Request no longer accepts type ${removed.join(", ")}.`, "type")
  }
}

function normalizeTypes(type: unknown): string[] {
  if (typeof type === "string") return [type]
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === "string")
  return []
}

function setsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry))
}

function compareEnums(
  previous: JsonSchema,
  current: JsonSchema,
  context: CompareContext,
  changes: CompatChange[],
) {
  const previousValues = Array.isArray(previous.enum) ? previous.enum.map(String) : null
  const currentValues = Array.isArray(current.enum) ? current.enum.map(String) : null

  if (!previousValues && !currentValues) return

  if (previousValues && !currentValues) {
    // Losing the constraint only matters for responses, where clients may
    // switch exhaustively on the documented values.
    if (context.variance === "response") {
      push(changes, "breaking", context, "Response enum constraint was removed.", "enum")
    }
    return
  }

  if (!previousValues || !currentValues) return

  const removed = previousValues.filter((value) => !currentValues.includes(value))
  const added = currentValues.filter((value) => !previousValues.includes(value))

  if (context.variance === "request" && removed.length) {
    push(changes, "breaking", context, `Request no longer accepts enum value(s): ${removed.join(", ")}.`, "enum")
  }

  if (context.variance === "response" && added.length) {
    // Clients written against the old contract have no branch for these.
    push(changes, "breaking", context, `Response may now return new enum value(s): ${added.join(", ")}.`, "enum")
  }
}

function compareProperties(
  previous: JsonSchema,
  current: JsonSchema,
  context: CompareContext,
  changes: CompatChange[],
  depth: number,
) {
  const previousProperties: Record<string, JsonSchema> = previous.properties || {}
  const currentProperties: Record<string, JsonSchema> = current.properties || {}
  const previousRequired: string[] = previous.required || []
  const currentRequired: string[] = current.required || []

  for (const [name, previousProperty] of Object.entries(previousProperties)) {
    const pointer = `${context.pointer}.${name}`
    const currentProperty = currentProperties[name]

    if (!currentProperty) {
      const isBreaking =
        context.variance === "response"
          ? // Only a guaranteed field is depended upon; an optional one may vanish.
            previousRequired.includes(name)
          : // A strict request schema starts rejecting a payload that used to work.
            current.additionalProperties === false

      changes.push({
        kind: isBreaking ? "breaking" : "additive",
        id: `removed-property ${context.operation} ${pointer}`,
        operation: context.operation,
        pointer,
        detail:
          context.variance === "response"
            ? `Response property "${name}" was removed.`
            : `Request property "${name}" is no longer accepted.`,
      })
      continue
    }

    compareSchema(previousProperty, currentProperty, { ...context, pointer }, changes, depth + 1)
  }

  for (const [name, currentProperty] of Object.entries(currentProperties)) {
    const pointer = `${context.pointer}.${name}`
    if (previousProperties[name]) continue

    if (context.variance === "request" && currentRequired.includes(name)) {
      changes.push({
        kind: "breaking",
        id: `new-required-property ${context.operation} ${pointer}`,
        operation: context.operation,
        pointer,
        detail: `New required request property "${name}" was added.`,
      })
      continue
    }

    changes.push({
      kind: "additive",
      id: `added-property ${context.operation} ${pointer}`,
      operation: context.operation,
      pointer,
      detail:
        context.variance === "response"
          ? `Response property "${name}" was added.`
          : `Optional request property "${name}" was added.`,
    })
    void currentProperty
  }

  for (const name of currentRequired) {
    if (!previousProperties[name]) continue
    if (previousRequired.includes(name)) continue

    if (context.variance === "request") {
      changes.push({
        kind: "breaking",
        id: `now-required ${context.operation} ${context.pointer}.${name}`,
        operation: context.operation,
        pointer: `${context.pointer}.${name}`,
        detail: `Request property "${name}" is now required.`,
      })
    }
  }

  for (const name of previousRequired) {
    if (!currentProperties[name]) continue
    if (currentRequired.includes(name)) continue

    if (context.variance === "response") {
      changes.push({
        kind: "breaking",
        id: `no-longer-guaranteed ${context.operation} ${context.pointer}.${name}`,
        operation: context.operation,
        pointer: `${context.pointer}.${name}`,
        detail: `Response property "${name}" is no longer guaranteed to be present.`,
      })
    }
  }
}

function push(
  changes: CompatChange[],
  kind: ChangeKind,
  context: CompareContext,
  detail: string,
  suffix: string,
) {
  changes.push({
    kind,
    id: `${suffix} ${context.operation} ${context.pointer}`,
    operation: context.operation,
    pointer: context.pointer,
    detail,
  })
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export interface ApprovedBreakingChange {
  id: string
  reason: string
  migrationUrl: string
  approvedOn: string
}

export interface CompatResult {
  breaking: CompatChange[]
  approved: CompatChange[]
  additive: CompatChange[]
  /** Approvals that no longer match any detected change and should be pruned. */
  staleApprovals: ApprovedBreakingChange[]
}

/**
 * Partitions detected changes against the approval list. A breaking change
 * ships only when someone has written down what it is, why, and where the
 * migration is documented.
 */
export function evaluateCompatibility(
  changes: CompatChange[],
  approvals: ApprovedBreakingChange[],
): CompatResult {
  const approvalsById = new Map(approvals.map((approval) => [approval.id, approval]))
  const matched = new Set<string>()

  const breaking: CompatChange[] = []
  const approved: CompatChange[] = []
  const additive: CompatChange[] = []

  for (const change of changes) {
    if (change.kind === "additive") {
      additive.push(change)
      continue
    }

    if (approvalsById.has(change.id)) {
      matched.add(change.id)
      approved.push(change)
      continue
    }

    breaking.push(change)
  }

  return {
    breaking,
    approved,
    additive,
    staleApprovals: approvals.filter((approval) => !matched.has(approval.id)),
  }
}
