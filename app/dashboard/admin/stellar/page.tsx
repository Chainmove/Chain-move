import { requireAdminAccess } from "@/src/server/admin/require-admin"
import { StellarActivityDashboard } from "@/components/dashboard/stellar-activity-dashboard"

export const dynamic = "force-dynamic"

export default async function AdminStellarPage() {
  await requireAdminAccess()

  return (
    <main className="min-w-0 p-4 sm:p-6 lg:p-8">
      <StellarActivityDashboard role="admin" />
    </main>
  )
}
