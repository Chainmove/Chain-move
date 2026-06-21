import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import { getClientIpAddress } from "@/lib/security/rate-limit"
import { validatePhoneNumberInput } from "@/lib/validation/phone"
import User from "@/models/User"

type RouteContext = { params: { id: string } }
type UserRole = "admin" | "driver" | "investor"

const VALID_ROLES: UserRole[] = ["admin", "driver", "investor"]

async function requireAdmin(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  }

  if (auth.user.role !== "admin") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  return auth
}

async function requireUserUpdateAccess(request: Request, targetUserId: string) {
  const auth = await getAuthenticatedUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  }

  const isSelf = auth.user._id.toString() === targetUserId
  const isAdmin = auth.user.role === "admin"
  if (!isAdmin && !isSelf) {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  return { ...auth, isAdmin, isSelf }
}

function normalizeRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeEmail(value: unknown) {
  const email = normalizeOptionalString(value)
  return email ? email.toLowerCase() : undefined
}

function normalizeWalletAddress(value: unknown) {
  const walletAddress = normalizeOptionalString(value)
  return walletAddress ? walletAddress.toLowerCase() : undefined
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

function resolveDuplicateKeyMessage(error: unknown) {
  if (!isDuplicateKeyError(error)) return "A unique user field is already in use."

  const duplicateField = typeof error === "object" && error !== null && "keyPattern" in error
    ? Object.keys((error as { keyPattern?: Record<string, unknown> }).keyPattern || {})[0]
    : null

  if (duplicateField === "email") return "That email address is already assigned to another user."
  if (duplicateField === "privyUserId") return "That Privy ID is already assigned to another user."
  if (duplicateField === "walletAddress" || duplicateField === "walletaddress") {
    return "That wallet address is already assigned to another user."
  }

  return "A unique user field is already in use."
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin(request)
    if ("error" in auth) return auth.error

    await dbConnect()

    const user = await User.findById(params.id).select(
      "name fullName email phoneNumber role walletAddress walletaddress privyUserId availableBalance totalInvested totalReturns createdAt",
    )

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }

    const response = NextResponse.json({
      ...user.toObject(),
      availableBalance: user.availableBalance || 0,
      totalInvested: user.totalInvested || 0,
      totalReturns: user.totalReturns || 0,
    })

    return auth.shouldRefreshSession ? withSessionRefresh(response, auth.user) : response
  } catch (error) {
    console.error("USER_GET_ERROR", error)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireUserUpdateAccess(request, params.id)
    if ("error" in auth) return auth.error

    await dbConnect()

    const body = await request.json().catch(() => ({}))
    const hasRole = Object.prototype.hasOwnProperty.call(body, "role")
    const hasName = Object.prototype.hasOwnProperty.call(body, "name")
    const hasFullName = Object.prototype.hasOwnProperty.call(body, "fullName")
    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email")
    const hasPhoneNumber = Object.prototype.hasOwnProperty.call(body, "phoneNumber")
    const hasPrivyUserId = Object.prototype.hasOwnProperty.call(body, "privyUserId")
    const hasWalletAddress = Object.prototype.hasOwnProperty.call(body, "walletAddress")

    const role = hasRole && typeof body.role === "string" ? (body.role as UserRole) : null
    if (hasRole && (!role || !VALID_ROLES.includes(role))) {
      return NextResponse.json({ message: "Invalid role specified" }, { status: 400 })
    }

    if (!auth.isAdmin && (hasRole || hasEmail || hasPrivyUserId || hasWalletAddress)) {
      return NextResponse.json(
        { message: "You can only update your own name and phone number from this screen." },
        { status: 403 },
      )
    }

    if (!hasRole && !hasName && !hasFullName && !hasEmail && !hasPhoneNumber && !hasPrivyUserId && !hasWalletAddress) {
      return NextResponse.json({ message: "No user changes were provided." }, { status: 400 })
    }

    if (params.id === auth.user!._id.toString() && hasRole && role !== "admin") {
      return NextResponse.json({ message: "You cannot remove your own admin access." }, { status: 403 })
    }

    const existingUser = await User.findById(params.id).select(
      "name fullName email phoneNumber role walletAddress walletaddress privyUserId",
    )
    if (!existingUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }

    const normalizedPhoneNumberResult = hasPhoneNumber
      ? validatePhoneNumberInput(body.phoneNumber, {
          required: auth.isSelf,
          allowEmpty: auth.isAdmin,
        })
      : { value: undefined as string | undefined, error: null as string | null }
    if (normalizedPhoneNumberResult.error) {
      return NextResponse.json({ message: normalizedPhoneNumberResult.error }, { status: 400 })
    }

    if (hasRole && existingUser.role === "admin" && role !== "admin") {
      const adminCount = await User.countDocuments({ role: "admin" })
      if (adminCount <= 1) {
        return NextResponse.json({ message: "At least one admin account must remain active." }, { status: 400 })
      }
    }

    const changedFields: string[] = []

    if (hasName) {
      const normalizedName = normalizeRequiredString(body.name)
      if (!normalizedName) {
        return NextResponse.json({ message: "Name is required." }, { status: 400 })
      }

      if (existingUser.name !== normalizedName) {
        existingUser.name = normalizedName
        changedFields.push("name")
      }
    }

    if (hasFullName) {
      const normalizedFullName = normalizeOptionalString(body.fullName)
      const nextFullName = normalizedFullName || existingUser.name
      if (existingUser.fullName !== nextFullName) {
        existingUser.fullName = nextFullName
        changedFields.push("fullName")
      }
    }

    if (hasEmail) {
      const normalizedEmail = normalizeEmail(body.email)
      if ((existingUser.email || undefined) !== normalizedEmail) {
        existingUser.email = normalizedEmail
        changedFields.push("email")
      }
    }

    if (hasPhoneNumber) {
      const normalizedPhoneNumber = normalizedPhoneNumberResult.value
      if ((existingUser.phoneNumber || undefined) !== normalizedPhoneNumber) {
        existingUser.phoneNumber = normalizedPhoneNumber
        changedFields.push("phoneNumber")
      }
    }

    if (hasPrivyUserId) {
      const normalizedPrivyUserId = normalizeOptionalString(body.privyUserId)
      if ((existingUser.privyUserId || undefined) !== normalizedPrivyUserId) {
        existingUser.privyUserId = normalizedPrivyUserId
        changedFields.push("privyUserId")
      }
    }

    if (hasWalletAddress) {
      const normalizedWalletAddress = normalizeWalletAddress(body.walletAddress)
      const currentWalletAddress = existingUser.walletAddress || existingUser.walletaddress || undefined
      if (currentWalletAddress !== normalizedWalletAddress) {
        existingUser.walletAddress = normalizedWalletAddress
        existingUser.walletaddress = normalizedWalletAddress
        changedFields.push("walletAddress")
      }
    }

    if (hasRole && role && existingUser.role !== role) {
      existingUser.role = role
      changedFields.push("role")
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ message: "No user changes were detected." }, { status: 200 })
    }

    await existingUser.save()

    await logAuditEvent({
      actor: auth.user,
      action: auth.isSelf ? "user.self_update" : "user.update",
      targetType: "user",
      targetId: params.id,
      ipAddress: getClientIpAddress(request),
      metadata: {
        changedFields,
        newRole: hasRole ? role : existingUser.role,
      },
    })

    const updatedUser = await User.findById(params.id)
      .select("name fullName email phoneNumber role privyUserId walletAddress walletaddress createdAt")
      .lean()

    const response = NextResponse.json({
      message:
        auth.isSelf
          ? "Profile updated successfully"
          : hasRole && role === "admin" && !changedFields.includes("role")
            ? "User updated successfully"
            : hasRole && role === "admin"
              ? "User updated and promoted to admin successfully"
              : "User updated successfully",
      user: updatedUser,
    })

    if (auth.isSelf) {
      return withSessionRefresh(response, existingUser)
    }

    return auth.shouldRefreshSession ? withSessionRefresh(response, auth.user) : response
  } catch (error) {
    console.error("USER_UPDATE_ERROR", error)

    if (isDuplicateKeyError(error)) {
      return NextResponse.json({ message: resolveDuplicateKeyMessage(error) }, { status: 409 })
    }

    return NextResponse.json({ message: "Server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin(request)
    if ("error" in auth) return auth.error

    await dbConnect()

    if (params.id === auth.user!._id.toString()) {
      return NextResponse.json({ message: "You cannot delete your own account." }, { status: 403 })
    }

    const existingUser = await User.findById(params.id).select("role")
    if (!existingUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }

    if (existingUser.role === "admin") {
      const adminCount = await User.countDocuments({ role: "admin" })
      if (adminCount <= 1) {
        return NextResponse.json({ message: "At least one admin account must remain active." }, { status: 400 })
      }
    }

    await User.findByIdAndDelete(params.id)

    await logAuditEvent({
      actor: auth.user,
      action: "user.delete",
      targetType: "user",
      targetId: params.id,
      ipAddress: getClientIpAddress(request),
      metadata: {
        deletedRole: existingUser.role,
      },
    })

    const response = NextResponse.json({ message: "User deleted successfully" })
    return auth.shouldRefreshSession ? withSessionRefresh(response, auth.user) : response
  } catch (error) {
    console.error("USER_DELETE_ERROR", error)
    return NextResponse.json({ message: "Server error during deletion" }, { status: 500 })
  }
}
