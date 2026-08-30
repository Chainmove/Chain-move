// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  buildPaginationMeta,
  DateRangeQuerySchema,
  MAX_PAGE_SIZE,
  PaginationQuerySchema,
  sortQuerySchema,
  toDateRangeFilter,
  toSkipLimit,
} from "@/lib/api/pagination"

describe("pagination query", () => {
  it("applies defaults when nothing is supplied", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })

  it("coerces string query values", () => {
    expect(PaginationQuerySchema.parse({ page: "3", pageSize: "50" })).toEqual({ page: 3, pageSize: 50 })
  })

  it("accepts the deprecated limit alias", () => {
    expect(PaginationQuerySchema.parse({ limit: "25" })).toEqual({ page: 1, pageSize: 25 })
  })

  it("prefers pageSize when both are supplied", () => {
    expect(PaginationQuerySchema.parse({ pageSize: "10", limit: "99" }).pageSize).toBe(10)
  })

  it("rejects a page size above the cap so a client cannot request the whole table", () => {
    expect(PaginationQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false)
  })

  it("rejects non-numeric and non-positive pages", () => {
    expect(PaginationQuerySchema.safeParse({ page: "abc" }).success).toBe(false)
    expect(PaginationQuerySchema.safeParse({ page: "0" }).success).toBe(false)
    expect(PaginationQuerySchema.safeParse({ page: "-1" }).success).toBe(false)
    expect(PaginationQuerySchema.safeParse({ pageSize: "1.5" }).success).toBe(false)
  })

  it("converts to Mongo skip and limit", () => {
    expect(toSkipLimit({ page: 3, pageSize: 20 })).toEqual({ skip: 40, limit: 20 })
  })
})

describe("pagination metadata", () => {
  it("describes a middle page", () => {
    expect(buildPaginationMeta({ page: 2, pageSize: 20, total: 55 })).toEqual({
      page: 2,
      pageSize: 20,
      total: 55,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    })
  })

  it("reports at least one page when empty, with no next or previous", () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 20, total: 0 })).toMatchObject({
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    })
  })

  it("marks the final page as having no next", () => {
    expect(buildPaginationMeta({ page: 3, pageSize: 20, total: 55 })).toMatchObject({
      hasNext: false,
      hasPrevious: true,
    })
  })
})

describe("sort conventions", () => {
  const schema = sortQuerySchema(["createdAt", "amount"], "createdAt")

  it("defaults to the declared field and descending order", () => {
    expect(schema.parse({})).toEqual({ sort: "createdAt", order: "desc" })
  })

  it("rejects a field outside the allow-list", () => {
    // Sorting on an arbitrary field would expose unindexed or private columns.
    expect(schema.safeParse({ sort: "passwordHash" }).success).toBe(false)
  })
})

describe("date range filters", () => {
  it("accepts calendar dates and full timestamps", () => {
    expect(DateRangeQuerySchema.safeParse({ from: "2026-01-01" }).success).toBe(true)
    expect(DateRangeQuerySchema.safeParse({ from: "2026-01-01T00:00:00Z" }).success).toBe(true)
  })

  it("rejects an unparsable bound rather than ignoring it", () => {
    expect(DateRangeQuerySchema.safeParse({ from: "last tuesday" }).success).toBe(false)
  })

  it("treats a bare end date as inclusive of that whole day", () => {
    const filter = toDateRangeFilter({ from: "2026-01-01", to: "2026-01-31" })

    expect(filter?.$gte?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(filter?.$lte?.toISOString()).toBe("2026-01-31T23:59:59.999Z")
  })

  it("returns undefined when neither bound is set", () => {
    expect(toDateRangeFilter({})).toBeUndefined()
  })
})
