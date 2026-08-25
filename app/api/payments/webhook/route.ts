import crypto from "crypto"
import { NextResponse } from "next/server"

import dbConnect from "@/lib/dbConnect"
import { timingSafeEqualHex } from "@/lib/security/constant-time-compare"
import { confirmDriverPayment, createAndConfirmDriverTransferPayment } from "@/lib/services/driver-contracts.service"
import { getInvestorVirtualAccountByAccountNumber } from "@/lib/services/paystack-investor-dva.service"
import { getDriverVirtualAccountByAccountNumber } from "@/lib/services/paystack-dva.service"
import { processGatewayCharge } from "@/lib/services/paystack-processing.service"

function resolvePaymentType(metadata: Record<string, unknown>) {
  const rawType = typeof metadata.paymentType === "string" ? metadata.paymentType.toLowerCase() : "wallet_funding"
  if (rawType === "down_payment") return "down_payment"
  if (rawType === "driver_repayment") return "driver_repayment"
  return "wallet_funding"
}

function resolveReceiverAccountNumber(charge: Record<string, any>) {
  const authorization = charge.authorization
  if (!authorization || typeof authorization !== "object") return null

  const accountNumber = authorization.receiver_bank_account_number
  return typeof accountNumber === "string" && accountNumber.trim() ? accountNumber.trim() : null
}

function isDedicatedVirtualAccountCharge(charge: Record<string, any>) {
  const authorization = charge.authorization
  if (!authorization || typeof authorization !== "object") return false
  return authorization.channel === "dedicated_nuban"
}

export async function POST(request: Request) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ message: "Server configuration error." }, { status: 500 })
  }

  const body = await request.text()
  const hash = crypto.createHmac("sha512", secretKey).update(body).digest("hex")
  const signature = request.headers.get("x-paystack-signature")

  if (!timingSafeEqualHex(signature, hash)) {
    return NextResponse.json({ message: "Invalid signature." }, { status: 401 })
  }

  const event = JSON.parse(body)
  const eventName = event.event as string
  const supportedEvents = [
    "charge.success",
    "charge.failed",
    "refund.processed",
    "transfer.reversed",
    "charge.dispute.create",
    "charge.dispute.resolve",
  ]

  if (!supportedEvents.includes(eventName)) {
    return NextResponse.json({ status: "ignored" }, { status: 200 })
  }

  try {
    await dbConnect()

    const charge = event.data
    const reference = charge.reference as string
    if (!reference) {
      return NextResponse.json({ message: "Missing transaction reference." }, { status: 400 })
    }

    if (isDedicatedVirtualAccountCharge(charge)) {
      const amountNgn = Number(charge.amount) / 100
      const email = charge.customer?.email as string | undefined
      const receiverAccountNumber = resolveReceiverAccountNumber(charge)
      if (!receiverAccountNumber) {
        return NextResponse.json({ message: "Missing dedicated account number on webhook payload." }, { status: 400 })
      }

      const virtualAccount = await getDriverVirtualAccountByAccountNumber(receiverAccountNumber)
      if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
        return NextResponse.json({ message: "Invalid payment amount." }, { status: 400 })
      }

      const authorization = charge.authorization || {}
      if (virtualAccount) {
        const settlementResult = await createAndConfirmDriverTransferPayment({
          contractId: virtualAccount.contractId,
          driverUserId: virtualAccount.driverUserId,
          amountNgn,
          payerEmail: email,
          paystackRef: reference,
          channel: typeof authorization.channel === "string" ? authorization.channel : null,
          metadata: {
            ...(charge.metadata || {}),
            source: "driver_repayment_dedicated_account",
            receiverBankAccountNumber: receiverAccountNumber,
            receiverBank: authorization.receiver_bank || null,
            senderBank: authorization.sender_bank || null,
            senderBankAccountNumber: authorization.sender_bank_account_number || null,
            senderName: authorization.sender_name || null,
          },
        })

        return NextResponse.json(
          {
            status: "success",
            type: "driver_repayment",
            alreadyProcessed: settlementResult.alreadyProcessed,
          },
          { status: 200 },
        )
      }

      const investorVirtualAccount = await getInvestorVirtualAccountByAccountNumber(receiverAccountNumber)
      if (!investorVirtualAccount) {
        return NextResponse.json(
          {
            status: "ignored",
            reason: "No local dedicated virtual account matched the receiver account number.",
          },
          { status: 200 },
        )
      }

      const settlementResult = await processGatewayCharge({
        reference,
        paymentType: "wallet_funding",
        amountNgn,
        metadata: {
          ...(charge.metadata || {}),
          paymentType: "wallet_funding",
          userId: investorVirtualAccount.investorUserId,
          source: "investor_wallet_dedicated_account",
          investorVirtualAccountId: investorVirtualAccount.id,
          receiverBankAccountNumber: receiverAccountNumber,
          receiverBank: authorization.receiver_bank || null,
          senderBank: authorization.sender_bank || null,
          senderBankAccountNumber: authorization.sender_bank_account_number || null,
          senderName: authorization.sender_name || null,
        },
        email,
        fallbackUserId: investorVirtualAccount.investorUserId,
        channel: typeof authorization.channel === "string" ? authorization.channel : null,
        processedVia: "webhook",
      })

      return NextResponse.json(
        {
          status: "success",
          type: settlementResult.type,
          alreadyProcessed: settlementResult.alreadyProcessed,
        },
        { status: 200 },
      )
    }

    const metadata = charge.metadata || {}
    const paymentType = resolvePaymentType(metadata)
    const amountNgn = Number(charge.amount) / 100
    const email = charge.customer?.email as string | undefined

    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      return NextResponse.json({ message: "Invalid payment amount." }, { status: 400 })
    }

    if (paymentType === "driver_repayment") {
      await confirmDriverPayment(reference, {
        verifiedAmountNgn: amountNgn,
        channel: typeof charge.channel === "string" ? charge.channel : null,
        metadata,
      })
      return NextResponse.json({ message: "Driver repayment processed." }, { status: 200 })
    }

    const settlementResult = await processGatewayCharge({
      reference,
      paymentType: paymentType === "down_payment" ? "down_payment" : "wallet_funding",
      amountNgn,
      metadata,
      email,
      channel: typeof charge.channel === "string" ? charge.channel : null,
      processedVia: "webhook",
    })

    return NextResponse.json(
      {
        status: "success",
        alreadyProcessed: settlementResult.alreadyProcessed,
        type: settlementResult.type,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error("PAYSTACK_WEBHOOK_ERROR", error)
    return NextResponse.json({ message: "Error processing webhook." }, { status: 500 })
  }
}
