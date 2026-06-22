import type { ActivityCategory } from "@/lib/activity"
import Notification from "@/models/Notification"

interface CreateActivityInput {
  userId: string
  title: string
  message: string
  category: ActivityCategory
  type?: string
  priority?: "low" | "medium" | "high"
  link?: string
  createdBy?: string
}

/** Central activity writer for payment, KYC, vehicle, wallet, and indexer workflows. */
export function createActivity(input: CreateActivityInput) {
  return Notification.create({
    ...input,
    type: input.type || input.category,
    priority: input.priority || "medium",
  })
}
