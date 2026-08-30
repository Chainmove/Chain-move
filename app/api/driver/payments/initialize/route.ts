import { NextResponse } from "next/server"

import { withSessionRefresh } from "@/lib/auth/current-user"
import { authorizeRequest } from "@/lib/authorization/route"
import dbConnect from "@/lib/dbConnect"
import { createDriverPayment, markDriverPaymentFailed } from "@/lib/services/driver-contracts.service"
import HirePurchaseContract from "@/models/HirePurchaseContract"

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function resolveCallbackUrl(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  return `${appUrl}/dashboard/driver/repayment`
}

export async function POST(request: Request) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ message: "Paystack is not configured." }, { status: 500 })
  }

  try {
    await dbConnect()
    const body = await request.json().catch(() => ({}))
    const contractId = typeof body.contractId === "string" ? body.contractId.trim() : ""
    const amountNgn = Number(body.amountNgn ?? body.amount)

    if (!contractId) {
      return NextResponse.json({ message: "Contract ID is required." }, { status: 400 })
    }

    const contract = await HirePurchaseContract.findById(contractId).select("driverUserId status").lean()
    const auth = await authorizeRequest(request, "repayment:record", {
      type: "repayment", ownerId: contract?.driverUserId?.toString(), state: contract?.status, exists: Boolean(contract),
    })
    if ("response" in auth) return auth.response
    const { user, shouldRefreshSession } = auth
    const payerEmail = (user.email || "").trim().toLowerCase()

    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      return NextResponse.json({ message: "A valid amount is required." }, { status: 400 })
    }

    if (!payerEmail) {
      return NextResponse.json({ message: "An email is required for Paystack repayment." }, { status: 400 })
    }

    if (!isValidEmail(payerEmail)) {
      return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 })
    }

    const payment = await createDriverPayment({
      contractId,
      driverUserId: user._id.toString(),
      amountNgn,
      payerEmail,
    })

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(payment.amountNgn * 100),
        email: payerEmail,
        reference: payment.paystackRef,
        callback_url: resolveCallbackUrl(request),
        metadata: {
          paymentType: "driver_repayment",
          contractId: payment.contractId,
          driverPaymentId: payment.id,
          userId: payment.driverUserId,
          amountNgn: payment.amountNgn,
          payerEmail,
        },
      }),
    })

    const payload = await paystackResponse.json()
    if (!paystackResponse.ok || payload?.status === false) {
      await markDriverPaymentFailed({
        paystackRef: payment.paystackRef,
        reason: payload?.message || "Failed to initialize Paystack repayment.",
      })
      return NextResponse.json({ message: payload?.message || "Failed to initialize payment." }, { status: 500 })
    }

    const response = NextResponse.json({
      success: true,
      payment,
      data: payload?.data || null,
      message: payload?.message || "Payment initialized.",
    })

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize driver repayment."
    console.error("DRIVER_REPAYMENT_INITIALIZE_ERROR", error)
    return NextResponse.json({ message }, { status: 400 })
  }
}
