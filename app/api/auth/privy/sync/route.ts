import { NextResponse } from "next/server"
import { z } from "zod"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import type { ParsedPrivyProfile } from "@/lib/auth/privy"
import { extractPrivyTokenFromRequest, getPrivyProfileFromPayload, verifyPrivyToken } from "@/lib/auth/privy"
import { setSessionCookie, signSessionToken } from "@/lib/auth/session"
import { parseJsonBody } from "@/lib/api/validation"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { validatePhoneNumberInput } from "@/lib/validation/phone"
import { logAuthEvent } from "@/lib/auth/auth-event-log"

type RequestedUserRole = "driver" | "investor"

const bodySchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["driver", "investor"]).optional(),
  phoneNumber: z.string().trim().max(32).optional(),
})

let ensureUserEmailIndexPromise: Promise<void> | null = null

function normalizeRequestedRole(role: unknown): RequestedUserRole {
  if (role === "driver" || role === "investor") return role
  return "investor"
}

function isIndexNotFoundError(error: unknown) {
  if (!(error instanceof Error)) return false
  return /index not found|can't find index|ns not found/i.test(error.message)
}

function hasSafeEmailIndex(index: Record<string, unknown> | undefined) {
  if (!index) return false
  if (index.unique !== true) return false
  if (index.sparse === true) return true

  const partial = index.partialFilterExpression
  return typeof partial === "object" && partial !== null
}

async function ensureCompatibleUserEmailIndex() {
  if (ensureUserEmailIndexPromise) return ensureUserEmailIndexPromise

  ensureUserEmailIndexPromise = (async () => {
    const indexes = await User.collection.indexes()
    const emailIndex = indexes.find((index) => index.name === "email_1") as Record<string, unknown> | undefined

    if (hasSafeEmailIndex(emailIndex)) return

    if (emailIndex) {
      try {
        await User.collection.dropIndex("email_1")
      } catch (error) {
        if (!isIndexNotFoundError(error)) throw error
      }
    }

    await User.collection.createIndex(
      { email: 1 },
      {
        name: "email_1",
        unique: true,
        partialFilterExpression: { email: { $type: "string" } },
      },
    )
  })().catch((error) => {
    ensureUserEmailIndexPromise = null
    throw error
  })

  return ensureUserEmailIndexPromise
}

function fallbackName(fullName: string | undefined, email: string | undefined, walletAddress: string | undefined) {
  if (fullName && fullName.trim().length > 0) return fullName.trim()
  if (email && email.includes("@")) return email.split("@")[0]
  if (walletAddress) return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
  return "ChainMove User"
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

function normalizeWalletAddress(walletAddress: string | undefined) {
  if (!walletAddress) return undefined
  const trimmed = walletAddress.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : undefined
}

function buildMatchConditions(profile: ParsedPrivyProfile) {
  const conditions: Array<Record<string, unknown>> = [{ privyUserId: profile.privyUserId }]
  const email = profile.email?.toLowerCase()
  const walletAddress = normalizeWalletAddress(profile.walletAddress)

  if (email) conditions.push({ email })
  if (walletAddress) {
    conditions.push({ walletAddress })
    conditions.push({ walletaddress: walletAddress })
  }

  return conditions
}

async function findUserByPrivyProfile(profile: ParsedPrivyProfile) {
  const matchConditions = buildMatchConditions(profile)
  return User.findOne({ $or: matchConditions })
}

export async function POST(request: Request) {
  try {
    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("privy-sync", getClientIpAddress(request)),
      limit: 30,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const privyToken = extractPrivyTokenFromRequest(request)
    if (!privyToken) {
      return NextResponse.json({ message: "Missing Privy token." }, { status: 401 })
    }

    const privyPayload = await verifyPrivyToken(privyToken)
    const profile = getPrivyProfileFromPayload(privyPayload)

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const fullName = body.data.fullName?.trim() || undefined
    const requestedRole = normalizeRequestedRole(body.data.role as RequestedUserRole | undefined)
    const phoneNumberWasSubmitted = Object.prototype.hasOwnProperty.call(body.data, "phoneNumber")
    const submittedPhoneNumber = validatePhoneNumberInput(body.data.phoneNumber, {
      required: phoneNumberWasSubmitted,
    })
    if (submittedPhoneNumber.error) {
      return NextResponse.json({ message: submittedPhoneNumber.error }, { status: 400 })
    }

    const privyPhoneNumber = validatePhoneNumberInput(profile.phoneNumber, { allowEmpty: true }).value
    const preferredPhoneNumber = submittedPhoneNumber.value || privyPhoneNumber
    const normalizedEmail = profile.email?.toLowerCase()
    const normalizedWalletAddress = normalizeWalletAddress(profile.walletAddress)
    const defaultName = fallbackName(fullName, normalizedEmail, normalizedWalletAddress)

    await dbConnect()
    await ensureCompatibleUserEmailIndex()

    if (!profile.privyUserId) {
      return NextResponse.json({ message: "Invalid Privy profile." }, { status: 401 })
    }

    let user = await findUserByPrivyProfile({
      ...profile,
      email: normalizedEmail,
      walletAddress: normalizedWalletAddress,
    })

    if (!user) {
      if (!preferredPhoneNumber) {
        return NextResponse.json(
          { message: "Phone number is required to finish creating your account." },
          { status: 400 },
        )
      }

      try {
        user = await User.create({
          name: defaultName,
          fullName: defaultName,
          role: requestedRole,
          email: normalizedEmail,
          phoneNumber: preferredPhoneNumber,
          privyUserId: profile.privyUserId,
          walletAddress: normalizedWalletAddress,
          walletaddress: normalizedWalletAddress,
        })
      } catch (createError) {
        if (!isDuplicateKeyError(createError)) throw createError

        user = await findUserByPrivyProfile({
          ...profile,
          email: normalizedEmail,
          walletAddress: normalizedWalletAddress,
        })
        if (!user) throw createError
      }
    }

    if (!user) {
      return NextResponse.json({ message: "Unable to resolve user profile." }, { status: 500 })
    }

    if (fullName) {
      user.name = fullName
      user.fullName = fullName
    } else {
      if (!user.name) user.name = defaultName
      if (!user.fullName) user.fullName = defaultName
    }

    if (!user.privyUserId) user.privyUserId = profile.privyUserId

    if (normalizedEmail && user.email !== normalizedEmail) {
      const emailInUse = await User.exists({
        _id: { $ne: user._id },
        email: normalizedEmail,
      })
      if (!emailInUse) {
        user.email = normalizedEmail
      }
    }

    if (submittedPhoneNumber.value) {
      user.phoneNumber = submittedPhoneNumber.value
    } else if (!user.phoneNumber && privyPhoneNumber) {
      user.phoneNumber = privyPhoneNumber
    }

    if (normalizedWalletAddress) {
      const currentWallet = normalizeWalletAddress(user.walletAddress || user.walletaddress)
      if (currentWallet !== normalizedWalletAddress) {
        const walletInUse = await User.exists({
          _id: { $ne: user._id },
          $or: [{ walletAddress: normalizedWalletAddress }, { walletaddress: normalizedWalletAddress }],
        })

        if (!walletInUse) {
          user.walletAddress = normalizedWalletAddress
          user.walletaddress = normalizedWalletAddress
        }
      }
    }

    if (!user.role || (user.role !== "admin" && user.role !== "driver" && user.role !== "investor")) {
      user.role = requestedRole
    }

    try {
      await user.save()
    } catch (saveError) {
      if (!isDuplicateKeyError(saveError)) throw saveError

      const fallbackUser = await findUserByPrivyProfile({
        ...profile,
        email: normalizedEmail,
        walletAddress: normalizedWalletAddress,
      })

      if (!fallbackUser) throw saveError
      user = fallbackUser
    }

    const isNewUser = !user.createdAt || (Date.now() - new Date(user.createdAt).getTime() < 5_000)
    logAuthEvent({
      type: isNewUser ? "signup" : "login",
      userId: user._id.toString(),
      privyUserId: user.privyUserId,
      request,
    })

    const sessionToken = await signSessionToken({
      userId: user._id.toString(),
      role: user.role,
      name: user.name,
      privyUserId: user.privyUserId,
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        fullName: user.fullName || user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        walletAddress: user.walletAddress || user.walletaddress,
        availableBalance: user.availableBalance || 0,
        totalInvested: user.totalInvested || 0,
        totalReturns: user.totalReturns || 0,
      },
    })

    setSessionCookie(response, sessionToken)
    return response
  } catch (error) {
    console.error("PRIVY_SYNC_ERROR", error)
    if (error instanceof Error && /jwt|jwks|signature|issuer|audience|algorithm|subject/i.test(error.message)) {
      logAuthEvent({ type: "token_invalid", detail: "privy_sync verification failed", request })
      return NextResponse.json({ message: "Unable to verify Privy identity. Please sign in again." }, { status: 401 })
    }

    if (error instanceof Error && /session signing|JWT secret/i.test(error.message)) {
      return NextResponse.json({ message: "Server authentication is not configured correctly." }, { status: 500 })
    }

    return NextResponse.json({ message: "Unable to sync account with Privy." }, { status: 500 })
  }
}
