"use server"

import { revalidatePath } from "next/cache"

import { getSessionFromCookies } from "@/lib/auth/session"
import dbConnect from "@/lib/dbConnect"
import { sendEmail } from "@/lib/services/email.service"
import { logAuditEvent } from "@/lib/security/audit-log"
import { isSupportedKycDocumentReference } from "@/lib/security/kyc-documents"
import User from "@/models/User"

type KycStatus = "none" | "pending" | "approved_stage1" | "pending_stage2" | "approved_stage2" | "rejected"
type PhysicalMeetingStatus = "none" | "scheduled" | "approved" | "rescheduled" | "completed" | "rejected_stage2"
type KycUserRole = "driver" | "investor"

const KYC_NOTIFICATION_LINK: Record<KycUserRole, string> = {
  driver: "/dashboard/driver/kyc/status",
  investor: "/dashboard/investor/kyc/status",
}

function normalizeDateInput(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function isFutureCalendarDate(date: Date) {
  const requested = new Date(date)
  requested.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return requested > today
}

function sanitizeDocuments(documents: string[]) {
  if (!Array.isArray(documents)) return []

  return documents
    .map((document) => (typeof document === "string" ? document.trim() : ""))
    .filter((document) => document.length > 0 && isSupportedKycDocumentReference(document))
    .slice(0, 10)
}

function normalizeReason(reason: string | null | undefined) {
  if (typeof reason !== "string") return null
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null
}

function buildNotificationId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function formatMeetingDate(date: Date | null) {
  if (!date) return "your scheduled date"
  return date.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function buildEmailHtml(name: string, message: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #E57700; margin-bottom: 16px;">ChainMove Account Update</h2>
      <p style="margin-bottom: 12px;">Hello ${name},</p>
      <p style="margin-bottom: 12px; line-height: 1.6;">${message}</p>
      <p style="margin-bottom: 0;">Please sign in to your dashboard for full details.</p>
    </div>
  `
}

async function sendKycEmail(user: any, subject: string, message: string) {
  if (!user?.email) return

  try {
    await sendEmail({
      to: user.email,
      subject,
      html: buildEmailHtml(user.name || "there", message),
    })
  } catch (error) {
    console.error("KYC_EMAIL_SEND_ERROR", error)
  }
}

function buildKycNotification({
  role,
  oldKycStatus,
  newKycStatus,
  oldPhysicalMeetingStatus,
  newPhysicalMeetingStatus,
  physicalMeetingDate,
  reason,
}: {
  role: KycUserRole
  oldKycStatus: KycStatus
  newKycStatus: KycStatus
  oldPhysicalMeetingStatus: PhysicalMeetingStatus
  newPhysicalMeetingStatus: PhysicalMeetingStatus
  physicalMeetingDate: Date | null
  reason: string | null
}) {
  if (role === "investor") {
    if ((oldKycStatus === "none" || oldKycStatus === "rejected") && newKycStatus === "pending") {
      return {
        title: "KYC Documents Submitted",
        message: "Your investor KYC documents have been submitted for review.",
        subject: "ChainMove: investor KYC documents received",
        emailMessage: "Your investor KYC documents have been submitted for review.",
      }
    }

    if (oldKycStatus === "pending" && newKycStatus === "approved_stage2") {
      return {
        title: "KYC Approved",
        message: "Your investor KYC verification has been approved. You can continue funding and investing.",
        subject: "ChainMove: investor KYC approved",
        emailMessage: "Your investor KYC verification has been approved. You can continue funding and investing.",
      }
    }

    if (oldKycStatus === "pending" && newKycStatus === "rejected") {
      const rejectionMessage = reason ? ` Reason: ${reason}` : ""
      return {
        title: "KYC Rejected",
        message: `Your investor KYC verification was rejected.${rejectionMessage}`,
        subject: "ChainMove: investor KYC rejected",
        emailMessage: `Your investor KYC verification was rejected.${rejectionMessage}`,
      }
    }

    return null
  }

  if ((oldKycStatus === "none" || oldKycStatus === "rejected") && newKycStatus === "pending") {
    return {
      title: "KYC Documents Submitted",
      message: "Your KYC documents have been submitted for review. We will notify you after stage 1 is processed.",
      subject: "ChainMove: KYC documents received",
      emailMessage: "Your KYC documents have been submitted for review. We will notify you after stage 1 is processed.",
    }
  }

  if (oldKycStatus === "pending" && newKycStatus === "approved_stage1") {
    return {
      title: "KYC Stage 1 Approved",
      message: "Your first KYC stage has been approved. Please schedule your physical meeting for stage 2.",
      subject: "ChainMove: KYC stage 1 approved",
      emailMessage: "Your first KYC stage has been approved. Please sign in and schedule your physical meeting for stage 2.",
    }
  }

  if (oldKycStatus === "pending" && newKycStatus === "rejected") {
    const rejectionMessage = reason ? ` Reason: ${reason}` : ""
    return {
      title: "KYC Rejected",
      message: `Your KYC verification was rejected.${rejectionMessage}`,
      subject: "ChainMove: KYC rejected",
      emailMessage: `Your KYC verification was rejected.${rejectionMessage}`,
    }
  }

  if (oldPhysicalMeetingStatus === "scheduled" && newPhysicalMeetingStatus === "approved") {
    const dateLabel = formatMeetingDate(physicalMeetingDate)
    return {
      title: "Physical Meeting Approved",
      message: `Your physical meeting for ${dateLabel} has been approved.`,
      subject: "ChainMove: physical meeting approved",
      emailMessage: `Your physical meeting for ${dateLabel} has been approved.`,
    }
  }

  if (newPhysicalMeetingStatus === "rescheduled") {
    const dateLabel = formatMeetingDate(physicalMeetingDate)
    const reasonMessage = reason ? ` Reason: ${reason}` : ""
    return {
      title: "Physical Meeting Rescheduled",
      message: `Your physical meeting has been moved to ${dateLabel}.${reasonMessage}`,
      subject: "ChainMove: physical meeting rescheduled",
      emailMessage: `Your physical meeting has been moved to ${dateLabel}.${reasonMessage}`,
    }
  }

  if (oldKycStatus === "pending_stage2" && newKycStatus === "approved_stage2") {
    return {
      title: "KYC Fully Approved",
      message: "Your KYC verification is fully approved. You can now access the full driver workflow.",
      subject: "ChainMove: KYC fully approved",
      emailMessage: "Your KYC verification is fully approved. You can now access the full driver workflow.",
    }
  }

  if (newPhysicalMeetingStatus === "rejected_stage2") {
    const rejectionMessage = reason ? ` Reason: ${reason}` : ""
    return {
      title: "KYC Stage 2 Rejected",
      message: `Your physical meeting verification was rejected.${rejectionMessage}`,
      subject: "ChainMove: KYC stage 2 rejected",
      emailMessage: `Your physical meeting verification was rejected.${rejectionMessage}`,
    }
  }

  return null
}

export async function updateUserKycStatus(
  userId: string,
  status: KycStatus,
  documents: string[] = [],
  rejectionReason: string | null = null,
  physicalMeetingDate: Date | string | null = null,
  physicalMeetingStatus: PhysicalMeetingStatus | null = null,
) {
  try {
    await dbConnect()

    const session = await getSessionFromCookies()
    if (!session?.userId) {
      return { success: false, message: "Unauthorized." }
    }

    const [actor, user] = await Promise.all([User.findById(session.userId), User.findById(userId)])

    if (!actor) {
      return { success: false, message: "Authenticated user not found." }
    }

    if (!user) {
      return { success: false, message: "User not found." }
    }

    const userRole = user.role === "driver" || user.role === "investor" ? (user.role as KycUserRole) : null
    if (!userRole) {
      return { success: false, message: "This account does not support KYC updates." }
    }

    const oldKycStatus = (user.kycStatus || "none") as KycStatus
    const oldPhysicalMeetingStatus = (user.physicalMeetingStatus || "none") as PhysicalMeetingStatus
    const normalizedDocuments = sanitizeDocuments(documents)
    const normalizedReason = normalizeReason(rejectionReason)
    const normalizedMeetingDate = normalizeDateInput(physicalMeetingDate)

    if (actor.role === userRole) {
      if (actor._id.toString() !== user._id.toString()) {
        return { success: false, message: "Users can only update their own KYC." }
      }

      const isInitialSubmission = status === "pending" && physicalMeetingStatus === null
      const isMeetingSchedule = status === "approved_stage1" && physicalMeetingStatus === "scheduled"

      if (userRole === "investor") {
        if (!isInitialSubmission) {
          return { success: false, message: "Investors can only submit or resubmit their own KYC documents." }
        }

        if (oldKycStatus !== "none" && oldKycStatus !== "rejected") {
          return { success: false, message: "This KYC state cannot be resubmitted right now." }
        }

        if (normalizedDocuments.length === 0) {
          return { success: false, message: "KYC documents are required." }
        }

        user.kycStatus = "pending"
        user.kycDocuments = normalizedDocuments
        user.kycRejectionReason = null
        user.physicalMeetingDate = null
        user.physicalMeetingStatus = "none"
        user.isKycVerified = false
        user.kycVerified = false
      } else if (isInitialSubmission) {
        if (oldKycStatus !== "none" && oldKycStatus !== "rejected") {
          return { success: false, message: "This KYC state cannot be resubmitted right now." }
        }

        if (normalizedDocuments.length === 0) {
          return { success: false, message: "KYC documents are required." }
        }

        user.kycStatus = "pending"
        user.kycDocuments = normalizedDocuments
        user.kycRejectionReason = null
        user.physicalMeetingDate = null
        user.physicalMeetingStatus = "none"
        user.isKycVerified = false
        user.kycVerified = false
      } else if (isMeetingSchedule) {
        if (oldKycStatus !== "approved_stage1") {
          return { success: false, message: "Stage 1 must be approved before scheduling a meeting." }
        }

        if (oldPhysicalMeetingStatus !== "none" && oldPhysicalMeetingStatus !== "rescheduled") {
          return { success: false, message: "A physical meeting has already been requested." }
        }

        if (!normalizedMeetingDate || !isFutureCalendarDate(normalizedMeetingDate)) {
          return { success: false, message: "Select a future meeting date." }
        }

        user.kycStatus = "approved_stage1"
        user.physicalMeetingStatus = "scheduled"
        user.physicalMeetingDate = normalizedMeetingDate
      } else {
        return { success: false, message: "Drivers cannot perform this KYC update." }
      }
    } else if (actor.role === "admin") {
      if (userRole === "investor") {
        if (status === "approved_stage2" && physicalMeetingStatus === null) {
          if (oldKycStatus !== "pending") {
            return { success: false, message: "Only pending investor KYC requests can be approved." }
          }

          user.kycStatus = "approved_stage2"
          user.kycRejectionReason = null
          user.physicalMeetingStatus = "none"
          user.physicalMeetingDate = null
          user.isKycVerified = true
          user.kycVerified = true
        } else if (status === "rejected" && physicalMeetingStatus === null) {
          if (oldKycStatus !== "pending") {
            return { success: false, message: "Only pending investor KYC requests can be rejected." }
          }

          if (!normalizedReason) {
            return { success: false, message: "A rejection reason is required." }
          }

          user.kycStatus = "rejected"
          user.kycRejectionReason = normalizedReason
          user.physicalMeetingStatus = "none"
          user.physicalMeetingDate = null
          user.isKycVerified = false
          user.kycVerified = false
        } else {
          return { success: false, message: "Unsupported investor KYC transition." }
        }
      } else if (status === "approved_stage1" && physicalMeetingStatus === null) {
        if (oldKycStatus !== "pending") {
          return { success: false, message: "Only pending stage 1 requests can be approved." }
        }

        user.kycStatus = "approved_stage1"
        user.kycRejectionReason = null
        user.physicalMeetingStatus = "none"
        user.physicalMeetingDate = null
        user.isKycVerified = false
        user.kycVerified = false
      } else if (status === "rejected" && physicalMeetingStatus === null) {
        if (oldKycStatus !== "pending") {
          return { success: false, message: "Only pending stage 1 requests can be rejected." }
        }

        if (!normalizedReason) {
          return { success: false, message: "A rejection reason is required." }
        }

        user.kycStatus = "rejected"
        user.kycRejectionReason = normalizedReason
        user.physicalMeetingStatus = "none"
        user.physicalMeetingDate = null
        user.isKycVerified = false
        user.kycVerified = false
      } else if (physicalMeetingStatus === "approved") {
        if (oldPhysicalMeetingStatus !== "scheduled") {
          return { success: false, message: "Only scheduled meetings can be approved." }
        }

        if (!user.physicalMeetingDate && !normalizedMeetingDate) {
          return { success: false, message: "A physical meeting date is required." }
        }

        user.physicalMeetingStatus = "approved"
        user.physicalMeetingDate = normalizedMeetingDate || user.physicalMeetingDate
        user.kycStatus = "pending_stage2"
        user.kycRejectionReason = null
      } else if (physicalMeetingStatus === "rescheduled") {
        if (oldPhysicalMeetingStatus !== "scheduled" && oldPhysicalMeetingStatus !== "approved") {
          return { success: false, message: "Only active meeting requests can be rescheduled." }
        }

        if (!normalizedMeetingDate || !isFutureCalendarDate(normalizedMeetingDate)) {
          return { success: false, message: "Select a future meeting date for the reschedule." }
        }

        user.physicalMeetingStatus = "rescheduled"
        user.physicalMeetingDate = normalizedMeetingDate
        user.kycStatus = "approved_stage1"
        user.kycRejectionReason = null
      } else if (status === "approved_stage2" && physicalMeetingStatus === "completed") {
        if (oldKycStatus !== "pending_stage2" || oldPhysicalMeetingStatus !== "approved") {
          return { success: false, message: "Only approved stage 2 meetings can be completed." }
        }

        user.kycStatus = "approved_stage2"
        user.physicalMeetingStatus = "completed"
        user.kycRejectionReason = null
        user.isKycVerified = true
        user.kycVerified = true
      } else if (status === "rejected" && physicalMeetingStatus === "rejected_stage2") {
        if (oldKycStatus !== "pending_stage2" || oldPhysicalMeetingStatus !== "approved") {
          return { success: false, message: "Only approved stage 2 meetings can be rejected." }
        }

        if (!normalizedReason) {
          return { success: false, message: "A rejection reason is required." }
        }

        user.kycStatus = "rejected"
        user.physicalMeetingStatus = "rejected_stage2"
        user.kycRejectionReason = normalizedReason
        user.isKycVerified = false
        user.kycVerified = false
      } else {
        return { success: false, message: "Unsupported admin KYC transition." }
      }

      if (normalizedDocuments.length > 0) {
        user.kycDocuments = normalizedDocuments
      }
    } else {
      return { success: false, message: "This account cannot manage KYC." }
    }

    const notification = buildKycNotification({
      role: userRole,
      oldKycStatus,
      newKycStatus: user.kycStatus,
      oldPhysicalMeetingStatus,
      newPhysicalMeetingStatus: user.physicalMeetingStatus || "none",
      physicalMeetingDate: normalizeDateInput(user.physicalMeetingDate),
      reason: normalizedReason,
    })

    if (notification) {
      user.notifications = Array.isArray(user.notifications) ? user.notifications : []
      user.notifications.push({
        id: buildNotificationId(),
        title: notification.title,
        message: notification.message,
        read: false,
        timestamp: new Date(),
        link: KYC_NOTIFICATION_LINK[userRole],
      })
    }

    await user.save()

    await logAuditEvent({
      actor,
      action: "kyc.status.update",
      targetType: "user",
      targetId: user._id.toString(),
      metadata: {
        oldKycStatus,
        newKycStatus: user.kycStatus,
        oldPhysicalMeetingStatus,
        newPhysicalMeetingStatus: user.physicalMeetingStatus || "none",
      },
    })

    if (notification) {
      await sendKycEmail(user, notification.subject, notification.emailMessage)
    }

    revalidatePath("/dashboard/driver")
    revalidatePath("/dashboard/driver/kyc")
    revalidatePath("/dashboard/driver/kyc/status")
    revalidatePath("/dashboard/driver/notifications")
    revalidatePath("/dashboard/investor")
    revalidatePath("/dashboard/investor/kyc")
    revalidatePath("/dashboard/investor/kyc/status")
    revalidatePath("/dashboard/investor/settings")
    revalidatePath("/dashboard/admin/kyc-management")
    revalidatePath("/dashboard/admin/investors")
    revalidatePath("/dashboard/admin/drivers")

    return { success: true, message: `KYC status updated to ${user.kycStatus}.` }
  } catch (error) {
    console.error("KYC_STATUS_UPDATE_ERROR", error)
    return { success: false, message: "Failed to update KYC status." }
  }
}
