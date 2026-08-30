export class DomainTransitionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "DomainTransitionError"
    this.code = code
  }
}

export class DomainConcurrencyError extends DomainTransitionError {
  entityType: string

  constructor(entityType: string) {
    super(
      "CONCURRENCY_CONFLICT",
      `This ${entityType} was modified by another transition. Please retry.`,
    )
    this.name = "DomainConcurrencyError"
    this.entityType = entityType
  }
}

export function isWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { code?: number; codeName?: string; errorLabels?: string[] }
  return (
    err.code === 112 ||
    err.codeName === "WriteConflict" ||
    (err.errorLabels || []).includes("TransientTransactionError")
  )
}
