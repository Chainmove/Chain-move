import { NextResponse } from "next/server"
import { z } from "zod"
import User from "@/models/User"
import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { parseJsonBody } from "@/lib/api/validation"
import { toUserProfileSnapshot } from "@/lib/users/user-profile"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"

const bodySchema = z.object({
  stellarPublicKey: z.string().trim().min(1, "Stellar public account is required."),
})

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  )
}

export async function POST(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const stellarPublicKey = normalizeStellarPublicKey(body.data.stellarPublicKey)
    if (!isValidStellarPublicKey(stellarPublicKey)) {
      return NextResponse.json({ message: "Invalid Stellar public account." }, { status: 400 })
    }

    const existingOwner = await User.findOne({ stellarPublicKey }).select("_id")
    if (existingOwner && existingOwner._id.toString() !== user._id.toString()) {
      return NextResponse.json(
        { message: "This Stellar account is already linked to another user." },
        { status: 409 },
      )
    }

    const isFirstLink = !user.stellarPublicKey
    user.stellarPublicKey = stellarPublicKey
    if (isFirstLink) {
      user.stellarLinkedAt = new Date()
    }

    try {
      await user.save()
    } catch (saveError) {
      // A concurrent request can win the race between the lookup above and this
      // save; the unique index then rejects the duplicate with code 11000.
      if (isDuplicateKeyError(saveError)) {
        return NextResponse.json(
          { message: "This Stellar account is already linked to another user." },
          { status: 409 },
        )
      }
      throw saveError
    }

    const response = NextResponse.json({ user: toUserProfileSnapshot(user) })
    if (shouldRefreshSession) {
      await withSessionRefresh(response, user)
    }
    return response
  } catch (error) {
    console.error("STELLAR_LINK_ERROR", error)
    return NextResponse.json({ message: "Unable to link Stellar account." }, { status: 500 })
  }
}
