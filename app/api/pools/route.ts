import {
  PoolCreateRequestSchema,
  PoolCreateResponseSchema,
  PoolListQuerySchema,
  PoolListResponseSchema,
} from "@/lib/api/contracts"
import { ApiError } from "@/lib/api/errors"
import { defineRoute } from "@/lib/api/route-handler"
import { serializePool } from "@/lib/api/serializers/pool"
import { createPool, listPools } from "@/lib/services/pools.service"

export const GET = defineRoute({
  operationId: "listPools",
  method: "GET",
  auth: "authenticated",
  query: PoolListQuerySchema,
  response: PoolListResponseSchema,
  successStatus: 200,
  handler: async ({ user, query }) => {
    const pools = await listPools(String(user._id))
    const filtered = query.status ? pools.filter((pool) => pool.status === query.status) : pools

    return {
      success: true as const,
      pools: filtered.map(serializePool),
    }
  },
})

export const POST = defineRoute({
  operationId: "createPool",
  method: "POST",
  auth: "authenticated",
  roles: ["admin", "investor"],
  body: PoolCreateRequestSchema,
  response: PoolCreateResponseSchema,
  successStatus: 201,
  handler: async ({ user, body }) => {
    let pool
    try {
      pool = await createPool({
        assetType: body.assetType,
        createdBy: String(user._id),
        targetAmountNgn: body.targetAmountNgn,
        minContributionNgn: body.minContributionNgn,
        description: body.description,
      })
    } catch (error) {
      // The service throws plain `Error`s for rule violations such as an
      // unknown asset type. They are caller-fixable, so they map to a
      // validation error rather than a 500 — but the service message is not
      // echoed, since it is not authored as client-facing copy.
      if (error instanceof Error && !("apiErrorCode" in error)) {
        throw ApiError.unprocessable("The pool could not be created with the supplied details.", [
          { path: "assetType", message: "Unsupported or invalid pool configuration." },
        ])
      }
      throw error
    }

    return { success: true as const, pool: serializePool(pool) }
  },
})
