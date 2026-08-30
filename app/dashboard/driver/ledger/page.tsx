import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardHeader } from "@/components/dashboard/investor-overview/dashboard-header"
import { TransactionLedger } from "@/components/dashboard/ledger/transaction-ledger"
import dbConnect from "@/lib/dbConnect"
import { getSessionFromCookies } from "@/lib/auth/session"
import User from "@/models/User"

export const dynamic = "force-dynamic"

function resolveDisplayName(user: { fullName?: string; name?: string; email?: string | null }) {
  if (user.fullName && user.fullName.trim()) return user.fullName.trim()
  if (user.name && user.name.trim()) return user.name.trim()
  if (user.email) return user.email.split("@")[0]
  return "Driver"
}

export default async function DriverLedgerPage() {
  const session = await getSessionFromCookies()
  if (!session?.userId) {
    redirect("/signin")
  }

  await dbConnect()
  const user = await User.findById(session.userId).select("name fullName email role")

  if (!user || user.role !== "driver") {
    redirect("/signin")
  }

  return (
    <DashboardShell
      role="driver"
      sidebarWidth="compact"
      header={
        <DashboardHeader
          title="Transaction Ledger"
          welcomeName={resolveDisplayName({
            fullName: user.fullName,
            name: user.name,
            email: user.email,
          })}
        />
      }
    >
      <main className="min-w-0 p-4 md:p-6">
        <TransactionLedger
          role="driver"
          description="Your repayments, wallet activity, and reconciliation status."
        />
      </main>
    </DashboardShell>
  )
}
