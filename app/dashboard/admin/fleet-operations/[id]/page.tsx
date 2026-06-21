import Link from "next/link"
import { notFound } from "next/navigation"
import mongoose from "mongoose"
import { ArrowLeft } from "lucide-react"

import { MetricCard } from "@/components/dashboard/admin/metric-card"
import { PageHeader } from "@/components/dashboard/admin/page-header"
import { RepaymentBar } from "@/components/dashboard/admin/repayment-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatNaira, formatPercent } from "@/lib/currency"
import dbConnect from "@/lib/dbConnect"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Vehicle from "@/models/Vehicle"
import { requireAdminAccess } from "@/src/server/admin/require-admin"
import {
  contractStatusBadgeClass,
  normalizeVehicleStatus,
  pickOperationalContract,
  repaymentPercent,
  vehicleStatusBadgeClass,
} from "@/src/server/admin/fleet"

export const dynamic = "force-dynamic"

interface VehicleDetailPageProps {
  params: Promise<{ id: string }>
}

function formatDate(value?: Date | string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
}

function driverLabel(driver: any) {
  if (!driver) return "Unassigned"
  return driver.fullName || driver.name || driver.email || "Unnamed driver"
}

function paymentStatusBadgeClass(status?: string | null) {
  const value = (status || "").toUpperCase()
  if (value === "CONFIRMED") return "bg-green-600 text-white hover:bg-green-600"
  if (value === "FAILED") return "bg-red-600 text-white hover:bg-red-600"
  return "bg-amber-600 text-white hover:bg-amber-600"
}

const SPEC_FIELDS: Array<{ key: string; label: string }> = [
  { key: "engine", label: "Engine" },
  { key: "fuelType", label: "Fuel Type" },
  { key: "transmission", label: "Transmission" },
  { key: "mileage", label: "Mileage" },
  { key: "color", label: "Color" },
  { key: "vin", label: "VIN" },
]

export default async function AdminVehicleDetailPage({ params }: VehicleDetailPageProps) {
  await requireAdminAccess()

  const { id } = await params
  if (!mongoose.Types.ObjectId.isValid(id)) {
    notFound()
  }

  await dbConnect()

  const vehicle = await Vehicle.findById(id).populate("driverId", "name fullName email").lean<any>()
  if (!vehicle) {
    notFound()
  }

  const contractList: any[] = await HirePurchaseContract.find({ vehicleDisplayName: vehicle.name })
    .sort({ createdAt: -1 })
    .lean()
  const contract = pickOperationalContract(contractList)

  const payments = contract
    ? await DriverPayment.find({ contractId: contract._id })
        .select("amountNgn appliedAmountNgn method paystackRef status confirmedAt createdAt")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    : []

  const statusLabel = normalizeVehicleStatus(vehicle.status)
  const percent = contract ? repaymentPercent(contract.totalPaidNgn, contract.totalPayableNgn) : null
  const specifications = (vehicle.specifications || {}) as Record<string, string | undefined>

  return (
    <div className="space-y-5">
      <PageHeader
        title={vehicle.name}
        subtitle={`${vehicle.type || "Vehicle"} · ${vehicle.identifier || specifications.vin || "No identifier"}`}
        actions={
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link href="/dashboard/admin/fleet-operations">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to fleet
            </Link>
          </Button>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Status"
          value={
            <Badge variant="default" className={cn("text-sm", vehicleStatusBadgeClass(statusLabel))}>
              {statusLabel}
            </Badge>
          }
        />
        <MetricCard label="Assigned Driver" value={<span className="text-lg">{driverLabel(vehicle.driverId)}</span>} />
        <MetricCard
          label="Repayment"
          value={percent !== null ? formatPercent(percent, 0) : "—"}
          hint={contract ? `Contract ${contract.status}` : "No active contract"}
        />
        <MetricCard label="Vehicle Value" value={formatNaira(Number(vehicle.price || 0))} hint={`Year ${vehicle.year || "—"}`} />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Specifications */}
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base">Specifications</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {SPEC_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</dt>
                  <dd className="text-sm text-foreground">{specifications[field.key] || "Not provided"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Contract summary */}
        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Contract Summary</CardTitle>
            {contract ? (
              <Badge variant="default" className={cn(contractStatusBadgeClass(contract.status))}>
                {contract.status}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {contract ? (
              <div className="space-y-4">
                {percent !== null ? <RepaymentBar percent={percent} status={contract.status} /> : null}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Principal</dt>
                    <dd className="text-sm text-foreground">{formatNaira(Number(contract.principalNgn || 0))}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Deposit</dt>
                    <dd className="text-sm text-foreground">{formatNaira(Number(contract.depositNgn || 0))}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total Payable</dt>
                    <dd className="text-sm text-foreground">{formatNaira(Number(contract.totalPayableNgn || 0))}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total Paid</dt>
                    <dd className="text-sm text-foreground">{formatNaira(Number(contract.totalPaidNgn || 0))}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Weekly Payment</dt>
                    <dd className="text-sm text-foreground">{formatNaira(Number(contract.weeklyPaymentNgn || 0))}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Duration</dt>
                    <dd className="text-sm text-foreground">{contract.durationWeeks || 0} weeks</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Start Date</dt>
                    <dd className="text-sm text-foreground">{formatDate(contract.startDate)}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Next Due</dt>
                    <dd className="text-sm text-foreground">{formatDate(contract.nextDueDate)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No hire-purchase contract is linked to this vehicle yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment history */}
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Recent Repayments</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left">
                  <th className="px-6 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">Amount</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">Applied</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">Method</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">Reference</th>
                  <th className="px-6 py-3 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                      No repayments recorded yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((payment: any) => (
                    <tr key={payment._id.toString()} className="border-b border-border/60">
                      <td className="px-6 py-3 text-muted-foreground">{formatDate(payment.confirmedAt || payment.createdAt)}</td>
                      <td className="px-6 py-3 font-medium text-foreground">{formatNaira(Number(payment.amountNgn || 0))}</td>
                      <td className="px-6 py-3 text-muted-foreground">{formatNaira(Number(payment.appliedAmountNgn || 0))}</td>
                      <td className="px-6 py-3 text-muted-foreground">{payment.method || "—"}</td>
                      <td className="px-6 py-3">
                        <span className="block max-w-[200px] truncate text-muted-foreground">{payment.paystackRef || "—"}</span>
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="default" className={cn(paymentStatusBadgeClass(payment.status))}>
                          {payment.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
