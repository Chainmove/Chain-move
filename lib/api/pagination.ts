import { z } from "zod"

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/**
 * Canonical pagination query.
 *
 * `pageSize` is the supported parameter. `limit` is accepted as a deprecated
 * alias because earlier routes shipped with it; requests that send `limit`
 * receive a `Warning` header from the route wrapper. See
 * `docs/api-migration.md`.
 */
export const PaginationQuerySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value

    const input = { ...(value as Record<string, unknown>) }
    if (typeof input.pageSize === "undefined" && typeof input.limit !== "undefined") {
      input.pageSize = input.limit
    }
    delete input.limit

    return input
  },
  z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  }),
)

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>

/** Sort direction shared by every list endpoint. */
export const SortOrderSchema = z.enum(["asc", "desc"]).default("desc")

/**
 * Builds a sort query for a route, constrained to an allow-list so clients
 * cannot sort on unindexed or private fields.
 */
export function sortQuerySchema<const TFields extends readonly [string, ...string[]]>(
  fields: TFields,
  defaultField: TFields[number],
) {
  return z.object({
    sort: z.enum(fields).default(defaultField as TFields[number]),
    order: SortOrderSchema,
  })
}

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(1),
  hasNext: z.boolean(),
  hasPrevious: z.boolean(),
})

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>

export function buildPaginationMeta(input: { page: number; pageSize: number; total: number }): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize))

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    hasNext: input.page < totalPages,
    hasPrevious: input.page > 1,
  }
}

/** Mongo `skip`/`limit` for a validated pagination query. */
export function toSkipLimit(query: PaginationQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    limit: query.pageSize,
  }
}

/** Wraps an item schema in the standard list envelope. */
export function paginatedResponseSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem, key = "data") {
  return z.object({
    success: z.literal(true),
    [key]: z.array(itemSchema),
    pagination: PaginationMetaSchema,
  } as { success: z.ZodLiteral<true>; pagination: typeof PaginationMetaSchema } & Record<string, z.ZodArray<TItem>>)
}

/* -------------------------------------------------------------------------- */
/* Shared filter conventions                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Inclusive date-range filter. Both bounds are ISO 8601 dates or date-times;
 * an invalid value is a field error rather than a silently ignored parameter.
 */
export const DateRangeQuerySchema = z.object({
  from: z
    .string()
    .trim()
    .datetime({ offset: true })
    .or(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  to: z
    .string()
    .trim()
    .datetime({ offset: true })
    .or(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
})

export const SearchQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
})

/** Converts a validated date-range filter into a Mongo range clause. */
export function toDateRangeFilter(range: z.infer<typeof DateRangeQuerySchema>) {
  const clause: { $gte?: Date; $lte?: Date } = {}

  if (range.from) clause.$gte = new Date(range.from)
  if (range.to) {
    // A bare calendar date means "through the end of that day".
    clause.$lte = /^\d{4}-\d{2}-\d{2}$/.test(range.to)
      ? new Date(`${range.to}T23:59:59.999Z`)
      : new Date(range.to)
  }

  return Object.keys(clause).length ? clause : undefined
}
