import User from "@/models/User"
import { fetchPrivyProfileByUserId } from "@/lib/auth/privy"

function normalizeString(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isProbablyRealName(value: string | null) {
  if (!value) return false
  if (value.includes("@")) return false
  if (value.startsWith("did:privy:")) return false
  return true
}

function resolveStoredFullName(user: {
  fullName?: string | null
  name?: string | null
}) {
  const fullName = normalizeString(user.fullName)
  if (isProbablyRealName(fullName)) return fullName

  const name = normalizeString(user.name)
  if (isProbablyRealName(name)) return name

  return null
}

export interface ResolvedDvaUserIdentity {
  user: any
  email: string | null
  fullName: string | null
  phoneNumber: string | null
}

export async function resolveDvaUserIdentity(
  userId: string,
  options?: {
    requiredRole?: "driver" | "investor" | "admin"
  },
): Promise<ResolvedDvaUserIdentity> {
  const user = await User.findById(userId).select("email fullName name phoneNumber privyUserId role")
  if (!user) {
    return {
      user: null,
      email: null,
      fullName: null,
      phoneNumber: null,
    }
  }

  if (options?.requiredRole && user.role !== options.requiredRole) {
    return {
      user,
      email: normalizeString(user.email)?.toLowerCase() || null,
      fullName: resolveStoredFullName(user as any),
      phoneNumber: normalizeString(user.phoneNumber),
    }
  }

  let email = normalizeString(user.email)?.toLowerCase() || null
  let fullName = resolveStoredFullName(user as any)
  let phoneNumber = normalizeString(user.phoneNumber)

  const needsPrivyFallback = (!email || !fullName || !phoneNumber) && normalizeString(user.privyUserId)
  if (needsPrivyFallback) {
    const privyProfile = await fetchPrivyProfileByUserId(String(user.privyUserId))
    if (privyProfile) {
      email = email || normalizeString(privyProfile.email)?.toLowerCase() || null
      fullName = fullName || normalizeString(privyProfile.fullName)
      phoneNumber = phoneNumber || normalizeString(privyProfile.phoneNumber)

      let shouldSave = false
      if (!normalizeString(user.email) && email) {
        user.email = email
        shouldSave = true
      }

      if (!normalizeString(user.phoneNumber) && phoneNumber) {
        user.phoneNumber = phoneNumber
        shouldSave = true
      }

      if (!resolveStoredFullName({ fullName: user.fullName, name: user.name }) && fullName) {
        if (!normalizeString(user.fullName)) {
          user.fullName = fullName
          shouldSave = true
        }

        if (!normalizeString(user.name) || !isProbablyRealName(normalizeString(user.name))) {
          user.name = fullName
          shouldSave = true
        }
      }

      if (shouldSave) {
        try {
          await user.save()
        } catch (error) {
          console.warn("DVA_IDENTITY_BACKFILL_SAVE_FAILED", {
            userId: user._id?.toString?.() || userId,
            message: error instanceof Error ? error.message : "Unknown error",
          })
        }
      }
    }
  }

  return {
    user,
    email,
    fullName,
    phoneNumber,
  }
}
