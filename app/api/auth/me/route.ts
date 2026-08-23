import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import { extractPrivyTokenFromRequest, getPrivyProfileFromPayload, verifyPrivyToken } from "@/lib/auth/privy"
import { getSessionFromCookies, setSessionCookie, signSessionToken } from "@/lib/auth/session"
import { toUserProfileSnapshot, USER_PROFILE_SELECT } from "@/lib/users/user-profile"

function toAuthResponse(user: any) {
  return {
    ...toUserProfileSnapshot(user),
    kycStatus: user.kycStatus || "none",
    kycDocuments: Array.isArray(user.kycDocuments) ? user.kycDocuments : [],
    kycRejectionReason: user.kycRejectionReason || null,
    physicalMeetingDate: user.physicalMeetingDate || null,
    physicalMeetingStatus: user.physicalMeetingStatus || "none",
    isKycVerified: user.isKycVerified === true,
    kycVerified: user.kycVerified === true,
  }
}

export async function GET(request: Request) {
  try {
    await dbConnect()

    const session = await getSessionFromCookies()
    if (session?.userId) {
      const user = await User.findById(session.userId).select(
        `${USER_PROFILE_SELECT} kycStatus kycDocuments kycRejectionReason physicalMeetingDate physicalMeetingStatus isKycVerified kycVerified`,
      )

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 })
      }

      return NextResponse.json(toAuthResponse(user))
    }

    // Fallback path: verify Privy JWT directly if provided.
    const privyToken = extractPrivyTokenFromRequest(request)
    if (!privyToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const privyPayload = await verifyPrivyToken(privyToken)
    const profile = getPrivyProfileFromPayload(privyPayload)

    const user = await User.findOne({
      $or: [{ privyUserId: profile.privyUserId }, ...(profile.email ? [{ email: profile.email.toLowerCase() }] : [])],
    }).select(
      `${USER_PROFILE_SELECT} kycStatus kycDocuments kycRejectionReason physicalMeetingDate physicalMeetingStatus isKycVerified kycVerified`,
    )

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const response = NextResponse.json(toAuthResponse(user))
    const sessionToken = await signSessionToken({
      userId: user._id.toString(),
      role: user.role,
      name: user.name,
      privyUserId: user.privyUserId,
    })
    setSessionCookie(response, sessionToken)
    return response
  } catch (error) {
    console.error("AUTH_ME_ERROR", error)
    return NextResponse.json({ error: "Invalid authentication state" }, { status: 401 })
  }
}
