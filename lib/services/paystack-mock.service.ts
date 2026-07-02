import { createHash } from "crypto"

export const MOCK_PAYSTACK_PROVIDER = "mock-paystack" as const
export const MOCK_PAYSTACK_BANK_NAME = "Mock Test Bank"
export const MOCK_PAYSTACK_ACCOUNT_NAME = "ChainMove Test Driver"
export const MOCK_PAYSTACK_PROVIDER_SLUG = "mock-paystack"

export interface MockDriverDvaDetails {
  provider: typeof MOCK_PAYSTACK_PROVIDER
  accountNumber: string
  accountName: string
  bankName: string
  providerSlug: string
  reference: string
  currency: "NGN"
  mock: true
  testOnly: true
}

export function isMockPaymentsEnabled() {
  return process.env.ENABLE_MOCK_PAYMENTS === "true"
}

export function isMockPaymentsRuntimeAllowed() {
  return isMockPaymentsEnabled() && process.env.NODE_ENV !== "production"
}

function buildDeterministicAccountNumber(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex")
  return `0000${hash.slice(0, 6)}`
}

export function createMockDriverDvaDetails(input: {
  driverUserId: string
  contractId: string
  displayName?: string | null
}) {
  const accountNumber = buildDeterministicAccountNumber(`${input.driverUserId}:${input.contractId}`)
  const accountName = input.displayName?.trim()
    ? `${MOCK_PAYSTACK_ACCOUNT_NAME} (${input.displayName.trim()})`
    : MOCK_PAYSTACK_ACCOUNT_NAME

  return {
    provider: MOCK_PAYSTACK_PROVIDER,
    accountNumber,
    accountName,
    bankName: MOCK_PAYSTACK_BANK_NAME,
    providerSlug: MOCK_PAYSTACK_PROVIDER_SLUG,
    reference: `mock_dva_${Date.now()}`,
    currency: "NGN" as const,
    mock: true as const,
    testOnly: true as const,
  } satisfies MockDriverDvaDetails
}

export function createMockDvaRepaymentReference() {
  return `mock_dva_repay_${Date.now()}`
}

export function buildMockDedicatedNubanWebhookPayload(input: {
  accountNumber: string
  amountNgn: number
  payerEmail?: string | null
  reference?: string
}) {
  const reference = input.reference || createMockDvaRepaymentReference()
  const amountKobo = Math.round(input.amountNgn * 100)

  return {
    event: "charge.success",
    data: {
      reference,
      amount: amountKobo,
      customer: {
        email: input.payerEmail || "mock-driver@chainmove.test",
      },
      metadata: {
        source: "mock_paystack_dva",
        paymentType: "driver_repayment",
      },
      authorization: {
        channel: "dedicated_nuban",
        receiver_bank_account_number: input.accountNumber,
        receiver_bank: MOCK_PAYSTACK_BANK_NAME,
        sender_bank: "Mock Sender Bank",
        sender_bank_account_number: "1111111111",
        sender_name: "Mock Transfer Sender",
      },
    },
  }
}

export function isMockVirtualAccountRecord(rawResponse: Record<string, unknown> | null | undefined) {
  return rawResponse?.mock === true || rawResponse?.provider === MOCK_PAYSTACK_PROVIDER
}
