import { redirect } from "next/navigation"

export default function LegacyNotificationsPage() {
  redirect("/dashboard/driver/activity")
}
