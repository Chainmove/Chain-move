import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

export default function Loading() {
  return (
    <DashboardRouteLoading
      title="Loading transaction ledger"
      description="Preparing ledger entries, balances, filters, and reconciliation status."
    />
  )
}
