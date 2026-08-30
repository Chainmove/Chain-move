import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import Loan from "@/models/Loan"
import ProcessedGatewayEvent, { type GatewayPaymentType } from "@/models/ProcessedGatewayEvent"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import { logAuditEvent } from "@/lib/security/audit-log"
import { initiateSettlement, transitionSettlementState } from "@/lib/settlement/settlement-service"

type ProcessedVia = "verify" | "webhook"

type GatewayProcessingMetadata = Record<string, unknown>

export interface ProcessGatewayChargeInput {
  reference: string
  paymentType: GatewayPaymentType
  amountNgn: number
  metadata: GatewayProcessingMetadata
  email?: string
  fallbackUserId?: string
  channel?: string | null
  processedVia: ProcessedVia
}

export type ProcessGatewayChargeResult =
  | {
      type: "wallet_funding"
      alreadyProcessed: boolean
      amountNgn: number
      internalBalanceNgn: number
    }
  | {
      type: "down_payment"
      alreadyProcessed: boolean
      amountNgn: number
      loanId: string | null
    }

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number" &&
    (error as { code: number }).code === 11000
  )
}

async function resolveUserByMetadata({
  metadataUserId,
  email,
  fallbackUserId,
  session,
}: {
  metadataUserId?: string
  email?: string
  fallbackUserId?: string
  session: ClientSession
}) {
  if (isObjectId(metadataUserId)) {
    const byMetadataId = await User.findById(metadataUserId).session(session)
    if (byMetadataId) return byMetadataId
  }

  if (isObjectId(fallbackUserId)) {
    const byFallbackId = await User.findById(fallbackUserId).session(session)
    if (byFallbackId) return byFallbackId
  }

  if (email) {
    return User.findOne({ email: email.toLowerCase() }).session(session)
  }

  return null
}

async function loadExistingProcessedResult(reference: string): Promise<ProcessGatewayChargeResult> {
  const existingTransaction = await Transaction.findOne({
    gatewayReference: reference,
    status: "Completed",
  }).sort({ timestamp: -1 })

  if (existingTransaction?.type === "down_payment") {
    return {
      type: "down_payment",
      alreadyProcessed: true,
      amountNgn: Number(existingTransaction.amount || 0),
      loanId: existingTransaction.relatedId || null,
    }
  }

  if (existingTransaction?.type === "wallet_funding") {
    const user = existingTransaction.userId ? await User.findById(existingTransaction.userId).select("availableBalance") : null

    return {
      type: "wallet_funding",
      alreadyProcessed: true,
      amountNgn: Number(existingTransaction.amount || 0),
      internalBalanceNgn: Number(user?.availableBalance || 0),
    }
  }

  const processedLock = (await ProcessedGatewayEvent.findById(reference).lean()) as
    | { paymentType?: GatewayPaymentType }
    | null
  if (processedLock?.paymentType === "down_payment") {
    return {
      type: "down_payment",
      alreadyProcessed: true,
      amountNgn: 0,
      loanId: null,
    }
  }

  return {
    type: "wallet_funding",
    alreadyProcessed: true,
    amountNgn: 0,
    internalBalanceNgn: 0,
  }
}

export async function processGatewayCharge({
  reference,
  paymentType,
  amountNgn,
  metadata,
  email,
  fallbackUserId,
  channel,
  processedVia,
}: ProcessGatewayChargeInput): Promise<ProcessGatewayChargeResult> {
  await dbConnect()

  const normalizedReference = reference.trim()
  if (!normalizedReference) {
    throw new Error("Payment reference is required.")
  }

  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    throw new Error("Invalid payment amount.")
  }

  const session = await mongoose.startSession()
  let createdLock = false
  let result: ProcessGatewayChargeResult | null = null
  let auditTargetUserId: string | null = null
  let auditTargetLoanId: string | null = null

  try {
    await session.withTransaction(async () => {
      try {
        await ProcessedGatewayEvent.create(
          [
            {
              _id: normalizedReference,
              paymentType,
              processedVia,
            },
          ],
          { session },
        )
        createdLock = true
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return
        }
        throw error
      }

      if (paymentType === "down_payment") {
        const loanId = typeof metadata.loanId === "string" ? metadata.loanId : undefined
        const loan = isObjectId(loanId) ? await Loan.findById(loanId).session(session) : null
        const user = await resolveUserByMetadata({
          metadataUserId: typeof metadata.userId === "string" ? metadata.userId : undefined,
          email,
          fallbackUserId,
          session,
        })

        if (!loan || !user) {
          throw new Error("Unable to resolve down payment context.")
        }

        auditTargetLoanId = loan._id.toString()
        auditTargetUserId = user._id.toString()

        loan.set({
          downPaymentMade: true,
          downPaymentAmount: amountNgn,
          downPaymentDate: new Date(),
        })
        await loan.save({ session })

        await Transaction.create(
          [
            {
              userId: user._id,
              userType: user.role || "driver",
              amount: amountNgn,
              currency: "NGN",
              status: "Completed",
              type: "down_payment",
              method: "paystack",
              gatewayReference: normalizedReference,
              description: `Down payment for Loan #${loan._id.toString()}`,
              relatedId: loan._id.toString(),
            },
          ],
          { session },
        )

        result = {
          type: "down_payment",
          alreadyProcessed: false,
          amountNgn,
          loanId: loan._id.toString(),
        }
        return
      }

      const user = await resolveUserByMetadata({
        metadataUserId: typeof metadata.userId === "string" ? metadata.userId : undefined,
        email,
        fallbackUserId,
        session,
      })

      if (!user) {
        throw new Error("User not found for this transaction.")
      }

      auditTargetUserId = user._id.toString()

      user.availableBalance = Number(user.availableBalance || 0) + amountNgn
      await user.save({ session })

      await Transaction.create(
        [
          {
            userId: user._id,
            userType: user.role || "investor",
            amount: amountNgn,
            currency: "NGN",
            status: "Completed",
            type: "wallet_funding",
            method: "paystack",
            gatewayReference: normalizedReference,
            description: "Wallet funded via Paystack",
            metadata: {
              paymentType: "wallet_funding",
              channel,
            },
          },
        ],
        { session },
      )

      result = {
        type: "wallet_funding",
        alreadyProcessed: false,
        amountNgn,
        internalBalanceNgn: Number(user.availableBalance || 0),
      }
    })
  } catch (error) {
    await logAuditEvent({
      action: paymentType === "wallet_funding" ? "wallet.credit" : "loan.down_payment",
      targetType: paymentType === "wallet_funding" ? "user" : "loan",
      targetId: paymentType === "wallet_funding" ? auditTargetUserId : auditTargetLoanId,
      status: "failure",
      metadata: {
        reference: normalizedReference,
        paymentType,
        processedVia,
        amountNgn,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    })
    throw error
  } finally {
    await session.endSession()
  }

  if (!createdLock) {
    return loadExistingProcessedResult(normalizedReference)
  }

  if (!result) {
    throw new Error("Unable to process payment.")
  }

  await logAuditEvent({
    action: paymentType === "wallet_funding" ? "wallet.credit" : "loan.down_payment",
    targetType: paymentType === "wallet_funding" ? "user" : "loan",
    targetId: paymentType === "wallet_funding" ? auditTargetUserId : auditTargetLoanId,
    metadata: {
      reference: normalizedReference,
      paymentType,
      processedVia,
      amountNgn,
    },
  })

  return result
}
