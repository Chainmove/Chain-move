import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import Loan from "@/models/Loan"
import { jwtVerify } from "jose"
import { cookies } from "next/headers"
import { z } from "zod"
import { ExchangeRateQuoteService } from "@/lib/fx/quote-service"
import { MongooseQuoteRepository } from "@/lib/fx/mongoose-quote-repository"
import { parseDecimalToMinorUnits } from "@/lib/fx/types"

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret) {
    throw new Error("JWT_SECRET is required for payment authorization.")
  }

  return new TextEncoder().encode(secret)
}

const requestSchema = z.object({
  loanId: z.string().trim().min(1),
  quoteId: z.string().trim().min(1),
  amount: z.union([z.string().trim().min(1), z.number().finite().positive()]),
  currency: z.literal("USD").default("USD"),
})

export async function POST(request: Request) {
  try {
    console.log("Down payment API called")

    // Get JWT token from cookies
    const cookieStore = await cookies()
    const tokenCookie = cookieStore.get("token")?.value

    if (!tokenCookie) {
      console.log("No token found")
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Verify JWT token
    const { payload } = await jwtVerify(tokenCookie, getJwtSecret())
    const userId = payload.userId as string
    console.log("User ID from token:", userId)

    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ message: "Loan ID, locked quote ID, and exact USD amount are required" }, { status: 400 })
    }
    const { loanId, quoteId, amount, currency } = parsed.data
    const sourceAmountMinor = parseDecimalToMinorUnits(amount, "USD")
    console.log("Request data:", { loanId, quoteId, currency })

    const secretKey = process.env.PAYSTACK_SECRET_KEY

    if (!secretKey) {
      console.log("Paystack secret key not configured")
      return NextResponse.json({ message: "Payment service not configured" }, { status: 500 })
    }

    await dbConnect()
    console.log("Database connected")

    // Verify the loan exists and belongs to the user
    console.log("Looking for loan with ID:", loanId)
    const loan = await Loan.findById(loanId)
    if (!loan) {
      console.log("Loan not found")
      return NextResponse.json({ message: "Loan not found" }, { status: 404 })
    }
    console.log("Loan found:", loan._id)

    // Get user details
    const user = await User.findById(userId)
    if (!user) {
      console.log("User not found")
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }
    console.log("User found:", user.email)

    // Verify the loan belongs to this user
    if (loan.driverId.toString() !== user._id.toString()) {
      console.log("Loan ownership mismatch:", { loanDriverId: loan.driverId.toString(), userId: user._id.toString() })
      return NextResponse.json({ message: "Unauthorized access to loan" }, { status: 403 })
    }

    // Check if down payment already made
    if (loan.downPaymentMade) {
      console.log("Down payment already made")
      return NextResponse.json({ message: "Down payment already completed" }, { status: 400 })
    }
    console.log("Loan validation passed, consuming locked FX quote")

    const quoteService = new ExchangeRateQuoteService([], new MongooseQuoteRepository(), {
      maxQuoteAgeMs: 0,
      quoteTtlMs: 0,
      deviationThresholdBps: 0,
      markupBps: 0,
      supportedPairs: ["USD/NGN"],
    })
    let quote: Awaited<ReturnType<ExchangeRateQuoteService["consumeQuote"]>>
    try {
      quote = await quoteService.consumeQuote({
        quoteId,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMinor,
        consumedBy: `down-payment:${loanId}:${userId}`,
      })
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "FX quote could not be consumed" },
        { status: 409 },
      )
    }

    // Paystack consumes integer kobo directly from the immutable quote snapshot.
    const amountInKobo = quote.convertedAmountMinor

    // Initialize transaction with Paystack
    console.log("Calling Paystack API...")
    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: amountInKobo,
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin}/dashboard/driver/loan-terms?payment=success`,
        metadata: {
          loanId,
          paymentType: "down_payment",
          userId,
          quoteId: quote.id,
          quoteVersion: quote.version,
          sourceAmountMinor: quote.sourceAmountMinor,
          convertedAmountMinor: quote.convertedAmountMinor,
          selectedCurrency: currency,
          exchangeRate: quote.rate,
          providerRate: quote.providerRate,
          rateSource: quote.provider,
          rateTimestamp: quote.providerTimestamp.toISOString(),
          quoteFetchedAt: quote.fetchedAt.toISOString(),
          spreadBps: quote.spreadBps,
          quoteConsumer: quote.consumedBy,
        },
      }),
    })

    console.log("Paystack response status:", paystackResponse.status)
    const paystackData = await paystackResponse.json()
    console.log("Paystack response data:", paystackData)

    if (!paystackResponse.ok) {
      console.log("Paystack API error:", paystackData)
      return NextResponse.json({ message: "Payment initialization failed", error: paystackData }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: paystackData.data,
      conversionInfo: {
        quoteId: quote.id,
        sourceAmountMinor: quote.sourceAmountMinor,
        convertedAmountMinor: quote.convertedAmountMinor,
        exchangeRate: quote.rate,
        rateSource: quote.provider,
        rateTimestamp: quote.providerTimestamp,
        spreadBps: quote.spreadBps,
        selectedCurrency: currency,
      },
    })
  } catch (error) {
    console.error("Down payment API error:", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
