"use server"

import Notification from "@/models/Notification"
import dbConnect from "@/lib/dbConnect"
import { revalidatePath } from "next/cache"

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i

export async function markNotificationsAsRead(userId: string, notificationIds: string[]) {
  try {
    await dbConnect()

    // The Notification collection is the single source of truth for read state,
    // so this scopes the update by userId instead of loading the user document.
    const ids = notificationIds.filter((id) => OBJECT_ID_PATTERN.test(id))
    if (ids.length === 0) {
      return { success: false, message: "No valid notification ids supplied." }
    }

    await Notification.updateMany({ _id: { $in: ids }, userId }, { $set: { read: true } })

    // Revalidate paths to reflect changes in UI
    revalidatePath(`/dashboard/driver`)
    revalidatePath(`/dashboard/driver/activity`)
    revalidatePath(`/dashboard/driver/kyc/status`) // In case notification count is shown here

    return { success: true, message: "Notifications marked as read." }
  } catch (error) {
    console.error("Failed to mark notifications as read:", error)
    return { success: false, message: "Failed to mark notifications as read." }
  }
}
