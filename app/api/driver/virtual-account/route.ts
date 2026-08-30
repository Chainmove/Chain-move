import { DriverVirtualAccountResponseSchema } from "@/lib/api/contracts"
import { ApiError } from "@/lib/api/errors"
import { defineRoute } from "@/lib/api/route-handler"
import { money } from "@/lib/api/serialization"
import { getDriverContract } from "@/lib/services/driver-contracts.service"
import {
  DriverVirtualAccountProvisionError,
  getOrProvisionDriverVirtualAccount,
} from "@/lib/services/paystack-dva.service"

/**
 * Maps provider provisioning failures onto the standard envelope.
 *
 * The provider's own message is not forwarded: Paystack error text can quote
 * request payloads and business identifiers. The provider code is preserved in
 * server logs via `logContext` so support can still trace a failure.
 */
function mapProvisionError(error: unknown): never {
  if (!(error instanceof DriverVirtualAccountProvisionError)) throw error

  // 4xx from the provider means the request was rejected on its merits, so the
  // caller can act on it; 5xx means the provider itself is unhealthy.
  const isClientFault = error.statusCode >= 400 && error.statusCode < 500

  throw new ApiError(isClientFault ? "UNPROCESSABLE" : "UPSTREAM_PROVIDER_ERROR", {
    message: isClientFault
      ? "A dedicated account could not be created with your current profile details."
      : "The banking provider is temporarily unavailable. Please try again shortly.",
    cause: error,
    logContext: { providerCode: error.code, providerStatus: error.statusCode },
  })
}

export const GET = defineRoute({
  operationId: "getDriverVirtualAccount",
  method: "GET",
  auth: "authenticated",
  roles: ["driver"],
  response: DriverVirtualAccountResponseSchema,
  successStatus: 200,
  handler: async ({ user }) => {
    const contract = await getDriverContract(String(user._id))
    if (!contract || contract.status !== "ACTIVE") {
      throw ApiError.notFound(
        "An active hire-purchase contract is required before a virtual account can be assigned.",
      )
    }

    try {
      const virtualAccount = await getOrProvisionDriverVirtualAccount({
        driverUserId: String(user._id),
        contractId: contract.id,
      })

      return {
        success: true as const,
        virtualAccount: {
          accountNumber: virtualAccount.accountNumber,
          accountName: virtualAccount.accountName,
          bankName: virtualAccount.bankName,
          providerSlug: virtualAccount.providerSlug,
          status: virtualAccount.status,
          contractId: contract.id,
          remainingBalance: money(contract.remainingBalanceNgn),
          nextPaymentAmount: money(contract.nextPaymentAmountNgn),
          isMock: Boolean(virtualAccount.isMock),
          // `mockReference` is omitted: it is an internal test-harness handle.
        },
      }
    } catch (error) {
      return mapProvisionError(error)
    }
  },
})
