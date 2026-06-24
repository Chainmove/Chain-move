import mongoose from "mongoose"

import dbConnect from "@/lib/dbConnect"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import { resolveDvaUserIdentity } from "@/lib/services/dva-user-identity.service"

export interface DriverVirtualAccountSnapshot {
  id: string
  driverUserId: string
  contractId: string
  provider: "PAYSTACK"
  status: "PENDING" | "ACTIVE" | "FAILED" | "INACTIVE"
  paystackCustomerCode: string | null
  paystackCustomerId: number | null
  dedicatedAccountId: number | null
  accountNumber: string | null
  accountName: string | null
  bankName: string | null
  providerSlug: string | null
  currency: string | null
  failureReason: string | null
  rawResponse: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export class DriverVirtualAccountProvisionError extends Error {
  code: string
  statusCode: number

  constructor(message: string, options?: { code?: string; statusCode?: number }) {
    super(message)
    this.name = "DriverVirtualAccountProvisionError"
    this.code = options?.code || "DRIVER_VIRTUAL_ACCOUNT_ERROR"
    this.statusCode = options?.statusCode || 400
  }
}

interface ProvisionDriverVirtualAccountInput {
  driverUserId: string
  contractId?: string
}

interface PaystackCustomerRecord {
  id: number
  customer_code: string
  email: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
}

interface PaystackDedicatedAccountRecord {
  id: number
  account_name?: string | null
  account_number?: string | null
  assigned?: boolean
  active?: boolean
  currency?: string | null
  bank?: {
    name?: string | null
    slug?: string | null
  } | null
  customer?: {
    id?: number
    customer_code?: string | null
  } | null
}

function toObjectId(value: string, fieldLabel: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new DriverVirtualAccountProvisionError(`Invalid ${fieldLabel}.`, {
      code: "INVALID_INPUT",
      statusCode: 400,
    })
  }

  return new mongoose.Types.ObjectId(value)
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return new Date(0).toISOString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString()
  return date.toISOString()
}

function mapDriverVirtualAccountSnapshot(doc: any): DriverVirtualAccountSnapshot {
  return {
    id: doc._id.toString(),
    driverUserId: doc.driverUserId.toString(),
    contractId: doc.contractId.toString(),
    provider: doc.provider,
    status: doc.status,
    paystackCustomerCode: doc.paystackCustomerCode || null,
    paystackCustomerId: Number.isFinite(doc.paystackCustomerId) ? Number(doc.paystackCustomerId) : null,
    dedicatedAccountId: Number.isFinite(doc.dedicatedAccountId) ? Number(doc.dedicatedAccountId) : null,
    accountNumber: doc.accountNumber || null,
    accountName: doc.accountName || null,
    bankName: doc.bankName || null,
    providerSlug: doc.providerSlug || null,
    currency: doc.currency || null,
    failureReason: doc.failureReason || null,
    rawResponse: doc.rawResponse && typeof doc.rawResponse === "object" ? doc.rawResponse : null,
    createdAt: toIsoDate(doc.createdAt),
    updatedAt: toIsoDate(doc.updatedAt),
  }
}

function getPaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim()
  if (!secretKey) {
    throw new DriverVirtualAccountProvisionError("Paystack is not configured for driver virtual accounts.", {
      code: "PAYSTACK_NOT_CONFIGURED",
      statusCode: 500,
    })
  }

  return secretKey
}

function resolvePreferredBank(secretKey: string) {
  const configured = process.env.PAYSTACK_DVA_PREFERRED_BANK?.trim()
  if (configured) return configured
  return secretKey.startsWith("sk_test_") ? "test-bank" : "wema-bank"
}

function splitDisplayName(user: { fullName?: string | null; name?: string | null }) {
  const fullName = (user.fullName || user.name || "").trim()
  if (!fullName) {
    throw new DriverVirtualAccountProvisionError(
      "Driver profile is missing a legal name. Add a full name before requesting a virtual account.",
      {
        code: "MISSING_NAME",
        statusCode: 400,
      },
    )
  }

  const nameParts = fullName.split(/\s+/).filter(Boolean)
  const firstName = nameParts[0]
  const lastName = nameParts.slice(1).join(" ") || nameParts[0]

  return { fullName, firstName, lastName }
}

function normalizePhoneNumber(phoneNumber?: string | null) {
  const normalizedPhone = phoneNumber?.trim()
  if (!normalizedPhone) {
    throw new DriverVirtualAccountProvisionError(
      "Driver profile is missing a phone number. Add a phone number before requesting a virtual account.",
      {
        code: "MISSING_PHONE_NUMBER",
        statusCode: 400,
      },
    )
  }

  return normalizedPhone
}

function normalizeEmail(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) {
    throw new DriverVirtualAccountProvisionError(
      "Driver profile is missing an email address. Add an email address before requesting a virtual account.",
      {
        code: "MISSING_EMAIL",
        statusCode: 400,
      },
    )
  }

  return normalizedEmail
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

async function paystackRequest<TData>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PUT"
    body?: Record<string, unknown>
    allowNotFound?: boolean
  },
) {
  const secretKey = getPaystackSecretKey()
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  })

  const payload = await parseJsonResponse(response)
  if (options?.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok || (payload && typeof payload === "object" && "status" in payload && payload.status === false)) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Paystack request failed with status ${response.status}.`

    throw new DriverVirtualAccountProvisionError(message, {
      code: response.status >= 500 ? "PAYSTACK_UPSTREAM_ERROR" : "PAYSTACK_REQUEST_FAILED",
      statusCode: response.status >= 500 ? 502 : 400,
    })
  }

  return payload as { status: boolean; message?: string; data: TData }
}

async function fetchExistingPaystackCustomer(email: string, customerCode?: string | null) {
  if (customerCode) {
    const byCode = await paystackRequest<PaystackCustomerRecord>(`/customer/${encodeURIComponent(customerCode)}`, {
      allowNotFound: true,
    })
    if (byCode?.data) return byCode.data
  }

  const byEmail = await paystackRequest<PaystackCustomerRecord>(`/customer/${encodeURIComponent(email)}`, {
    allowNotFound: true,
  })

  return byEmail?.data || null
}

async function createOrUpdatePaystackCustomer(input: {
  email: string
  firstName: string
  lastName: string
  phoneNumber: string
  existingCustomerCode?: string | null
  metadata: Record<string, unknown>
}) {
  const existingCustomer = await fetchExistingPaystackCustomer(input.email, input.existingCustomerCode)

  if (existingCustomer?.customer_code) {
    const updatedCustomer = await paystackRequest<PaystackCustomerRecord>(
      `/customer/${encodeURIComponent(existingCustomer.customer_code)}`,
      {
        method: "PUT",
        body: {
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phoneNumber,
          metadata: input.metadata,
        },
      },
    )

    return updatedCustomer!.data
  }

  const createdCustomer = await paystackRequest<PaystackCustomerRecord>("/customer", {
    method: "POST",
    body: {
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phoneNumber,
      metadata: input.metadata,
    },
  })

  return createdCustomer!.data
}

async function listDedicatedAccountsForCustomer(customerId: number) {
  const params = new URLSearchParams({
    customer: String(customerId),
    active: "true",
  })

  const response = await paystackRequest<PaystackDedicatedAccountRecord[]>(`/dedicated_account?${params.toString()}`)
  return Array.isArray(response?.data) ? response.data : []
}

async function createDedicatedAccount(input: {
  customerId: number
  firstName: string
  lastName: string
  phoneNumber: string
  preferredBank: string
}) {
  const response = await paystackRequest<PaystackDedicatedAccountRecord>("/dedicated_account", {
    method: "POST",
    body: {
      customer: input.customerId,
      preferred_bank: input.preferredBank,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phoneNumber,
    },
  })

  return response!.data
}

async function resolveActiveContract(driverUserId: string, contractId?: string) {
  const driverObjectId = toObjectId(driverUserId, "driver user id")
  const filter: Record<string, unknown> = {
    driverUserId: driverObjectId,
    status: "ACTIVE",
  }

  if (contractId) {
    filter._id = toObjectId(contractId, "contract id")
  }

  const contract = await HirePurchaseContract.findOne(filter).sort({ createdAt: -1 })
  if (!contract) {
    throw new DriverVirtualAccountProvisionError(
      "An active hire-purchase contract is required before a driver virtual account can be provisioned.",
      {
        code: "ACTIVE_CONTRACT_REQUIRED",
        statusCode: 404,
      },
    )
  }

  return contract
}

export async function getDriverVirtualAccount(input: ProvisionDriverVirtualAccountInput) {
  await dbConnect()
  const driverObjectId = toObjectId(input.driverUserId, "driver user id")

  const filter: Record<string, unknown> = {
    driverUserId: driverObjectId,
    provider: "PAYSTACK",
  }

  if (input.contractId) {
    filter.contractId = toObjectId(input.contractId, "contract id")
  }

  const doc = await DriverVirtualAccount.findOne(filter).sort({ updatedAt: -1 }).lean()
  return doc ? mapDriverVirtualAccountSnapshot(doc) : null
}

export async function getDriverVirtualAccountByAccountNumber(accountNumber: string) {
  await dbConnect()
  const normalizedAccountNumber = accountNumber.trim()
  if (!normalizedAccountNumber) return null

  const doc = await DriverVirtualAccount.findOne({
    accountNumber: normalizedAccountNumber,
    provider: "PAYSTACK",
    status: "ACTIVE",
  }).lean()

  return doc ? mapDriverVirtualAccountSnapshot(doc) : null
}

export async function provisionDriverVirtualAccount(input: ProvisionDriverVirtualAccountInput) {
  await dbConnect()

  const secretKey = getPaystackSecretKey()
  const preferredBank = resolvePreferredBank(secretKey)
  const contract = await resolveActiveContract(input.driverUserId, input.contractId)
  const existingAccount = await DriverVirtualAccount.findOne({
    driverUserId: contract.driverUserId,
    provider: "PAYSTACK",
  })

  if (existingAccount?.status === "ACTIVE" && existingAccount.accountNumber) {
    if (!existingAccount.contractId?.equals(contract._id)) {
      existingAccount.contractId = contract._id
      existingAccount.failureReason = undefined
      await existingAccount.save()
    }

    return mapDriverVirtualAccountSnapshot(existingAccount)
  }

  const identity = await resolveDvaUserIdentity(contract.driverUserId.toString(), {
    requiredRole: "driver",
  })
  if (!identity.user || identity.user.role !== "driver") {
    throw new DriverVirtualAccountProvisionError("Driver record not found.", {
      code: "DRIVER_NOT_FOUND",
      statusCode: 404,
    })
  }

  const email = normalizeEmail(identity.email)
  const phoneNumber = normalizePhoneNumber(identity.phoneNumber)
  const { fullName, firstName, lastName } = splitDisplayName({
    fullName: identity.fullName,
    name: identity.user.name,
  })

  const customer = await createOrUpdatePaystackCustomer({
    email,
    firstName,
    lastName,
    phoneNumber,
    existingCustomerCode: existingAccount?.paystackCustomerCode || null,
    metadata: {
      source: "driver_repayment_dva",
      driverUserId: contract.driverUserId.toString(),
      contractId: contract._id.toString(),
      fullName,
    },
  })

  const existingDedicatedAccounts = await listDedicatedAccountsForCustomer(customer.id)
  const reusableDedicatedAccount = existingDedicatedAccounts.find(
    (account) => account.account_number && (account.active !== false || account.assigned !== false),
  )

  let dedicatedAccount = reusableDedicatedAccount || null
  if (!dedicatedAccount) {
    dedicatedAccount = await createDedicatedAccount({
      customerId: customer.id,
      firstName,
      lastName,
      phoneNumber,
      preferredBank,
    })
  }

  if (!dedicatedAccount?.account_number || !dedicatedAccount?.account_name) {
    // TODO: add richer customer identification fields if Paystack DVA eligibility for this business
    // requires BVN, bank account validation, or additional KYC inputs beyond name/phone/email.
    await DriverVirtualAccount.findOneAndUpdate(
      {
        driverUserId: contract.driverUserId,
        provider: "PAYSTACK",
      },
      {
        $set: {
          contractId: contract._id,
          status: "FAILED",
          paystackCustomerCode: customer.customer_code,
          paystackCustomerId: customer.id,
          rawResponse: dedicatedAccount || null,
          failureReason:
            "Paystack did not return a usable dedicated virtual account. Check Paystack DVA eligibility and KYC requirements.",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    throw new DriverVirtualAccountProvisionError(
      "Paystack could not provision a dedicated virtual account for this driver. Check driver profile completeness and Paystack DVA eligibility.",
      {
        code: "PAYSTACK_DVA_UNAVAILABLE",
        statusCode: 400,
      },
    )
  }

  const savedDoc = await DriverVirtualAccount.findOneAndUpdate(
    {
      driverUserId: contract.driverUserId,
      provider: "PAYSTACK",
    },
    {
      $set: {
        contractId: contract._id,
        status: "ACTIVE",
        paystackCustomerCode: customer.customer_code,
        paystackCustomerId: customer.id,
        dedicatedAccountId: dedicatedAccount.id,
        accountNumber: dedicatedAccount.account_number,
        accountName: dedicatedAccount.account_name,
        bankName: dedicatedAccount.bank?.name || null,
        providerSlug: dedicatedAccount.bank?.slug || preferredBank,
        currency: dedicatedAccount.currency || "NGN",
        rawResponse: dedicatedAccount,
        failureReason: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  return mapDriverVirtualAccountSnapshot(savedDoc)
}

export async function getOrProvisionDriverVirtualAccount(input: ProvisionDriverVirtualAccountInput) {
  const existing = await getDriverVirtualAccount(input)
  if (existing?.status === "ACTIVE" && existing.accountNumber) {
    return existing
  }

  return provisionDriverVirtualAccount(input)
}
