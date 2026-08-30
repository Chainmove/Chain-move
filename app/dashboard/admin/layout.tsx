"use client"

import type React from "react"

import { AdminShell } from "@/components/dashboard/admin/admin-shell"
import { DashboardGuard } from "@/components/dashboard/dashboard-guard"
import { useAuth } from "@/hooks/use-auth"

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return <AdminShell userName={user?.name || "Admin"}>{children}</AdminShell>
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardGuard
      allow="admin"
      loadingTitle="Loading admin dashboard"
      loadingDescription="Please wait while we verify your access."
    >
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </DashboardGuard>
  )
}
