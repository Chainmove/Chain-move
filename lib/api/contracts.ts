import { z } from "zod"

export const ApiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  issues: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
})

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export const MoneyMinorSchema = z.object({
  currency: z.string().length(3),
  amountMinor: z.number().int(),
})

export const PaymentInitializeRequestSchema = z
  .object({
    amount: z.number().positive().max(100_000_000).optional(),
    amountNgn: z.number().positive().max(100_000_000).optional(),
    email: z.string().email().optional(),
  })
  .strict()

export const PaymentInitializeResponseSchema = z.object({
  status: z.boolean().optional(),
  message: z.string().optional(),
  data: z
    .object({
      authorization_url: z.string().url().optional(),
      access_code: z.string().optional(),
      reference: z.string().optional(),
    })
    .optional(),
})

export const PoolInvestmentRequestSchema = z
  .object({
    amountNgn: z.number().positive().max(100_000_000),
    txRef: z.string().max(128).optional(),
  })
  .strict()

export const PoolInvestmentResponseSchema = z.object({
  success: z.literal(true),
  investment: z.object({
    poolId: z.string(),
    userId: z.string(),
    amountNgn: z.number(),
    ownershipUnits: z.number().int(),
    ownershipBps: z.number().int(),
    txRef: z.string(),
    poolStatus: z.enum(["OPEN", "FUNDED", "CLOSED"]),
    currentRaisedNgn: z.number(),
    targetAmountNgn: z.number(),
    investorCount: z.number().int(),
    userBalanceNgn: z.number(),
  }),
})

export const WebhookPaystackSchema = z.object({
  event: z.string(),
  data: z.record(z.unknown()),
})

export type ApiContract = {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  tag: string
  auth: "public" | "authenticated" | "admin" | "webhook"
  request?: z.ZodTypeAny
  response: z.ZodTypeAny
  errors?: readonly number[]
}

export const apiContracts: ApiContract[] = [
  {
    method: "POST",
    path: "/api/payments/initialize",
    tag: "payments",
    auth: "authenticated",
    request: PaymentInitializeRequestSchema,
    response: PaymentInitializeResponseSchema,
    errors: [400, 401, 429, 500],
  },
  {
    method: "POST",
    path: "/api/pools/{poolId}/invest",
    tag: "investments",
    auth: "authenticated",
    request: PoolInvestmentRequestSchema,
    response: PoolInvestmentResponseSchema,
    errors: [400, 401, 403, 503],
  },
  {
    method: "POST",
    path: "/api/payments/webhook",
    tag: "webhooks",
    auth: "webhook",
    request: WebhookPaystackSchema,
    response: z.object({ received: z.boolean().optional(), message: z.string().optional() }),
    errors: [400, 401, 500],
  },
]

export type PaymentInitializeRequest = z.infer<typeof PaymentInitializeRequestSchema>
export type PaymentInitializeResponse = z.infer<typeof PaymentInitializeResponseSchema>
export type PoolInvestmentRequest = z.infer<typeof PoolInvestmentRequestSchema>
export type PoolInvestmentResponse = z.infer<typeof PoolInvestmentResponseSchema>
