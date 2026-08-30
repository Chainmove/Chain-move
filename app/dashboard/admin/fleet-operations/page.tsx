import Link from "next/link"
import { Eye, Search } from "lucide-react"

import { MetricCard } from "@/components/dashboard/admin/metric-card"
import { PageHeader } from "@/components/dashboard/admin/page-header"
import { RepaymentBar } from "@/components/dashboard/admin/repayment-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

interface FleetPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const PAGE_SIZE = 20

function getParam(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

function toInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

interface FleetFilters {
  q: string
  status: string
  type: string
  contract: string
}

function buildFleetHref(filters: FleetFilters, page: number) {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.status !== "all") params.set("status", filters.status)
  if (filters.type !== "all") params.set("type", filters.type)
  if (filters.contract !== "all") params.set("contract", filters.contract)
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return query ? `/dashboard/admin/fleet-operations?${query}` : "/dashboard/admin/fleet-operations"
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

export default async function AdminFleetOperationsPage({ searchParams }: FleetPageProps) {
  await requireAdminAccess()
  await dbConnect()

  const resolved = (await searchParams) || {}
  const filters: FleetFilters = {
    q: getParam(resolved.q).trim(),
    status: getParam(resolved.status, "all"),
    type: getParam(resolved.type, "all"),
    contract: getParam(resolved.contract, "all"),
  }
  const page = toInt(getParam(resolved.page, "1"), 1)

  // ---- Fleet-level metrics (computed across the whole fleet, not the page) ----
  const [statusCounts, fleetValueAgg, activeContractAgg, collectedAgg] = await Promise.all([
    Vehicle.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Vehicle.aggregate([
      { $match: { status: { $ne: "Retired" } } },
      { $group: { _id: null, total: { $sum: "$price" } } },
    ]),
    HirePurchaseContract.aggregate([
      { $match: { status: "ACTIVE" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          paid: { $sum: "$totalPaidNgn" },
          payable: { $sum: "$totalPayableNgn" },
        },
      },
    ]),
    DriverPayment.aggregate([
      { $match: { status: "CONFIRMED" } },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $cond: [{ $gt: ["$appliedAmountNgn", 0] }, "$appliedAmountNgn", "$amountNgn"] },
          },
        },
      },
    ]),
  ])

  const countByStatus = (status: string) =>
    Number(statusCounts.find((entry: any) => entry._id === status)?.count || 0)

  const availableCount = countByStatus("Available")
  const assignedCount = countByStatus("Financed") + countByStatus("Reserved")
  const maintenanceCount = countByStatus("Maintenance")
  const retiredCount = countByStatus("Retired")
  const totalVehicles = statusCounts.reduce((acc: number, entry: any) => acc + Number(entry.count || 0), 0)
  const fleetSize = totalVehicles - retiredCount

  const fleetValue = Number(fleetValueAgg[0]?.total || 0)
  const activeContracts = Number(activeContractAgg[0]?.count || 0)
  const avgRepayment = repaymentPercent(activeContractAgg[0]?.paid, activeContractAgg[0]?.payable)
  const totalCollected = Number(collectedAgg[0]?.total || 0)

  // ---- Vehicle table query (respects filters + pagination) ----
  const query: Record<string, unknown> = {}

  if (filters.q) {
    const regex = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    query.$or = [{ name: regex }, { type: regex }, { identifier: regex }, { "specifications.vin": regex }]
  }

  if (filters.type !== "all") query.type = filters.type

  if (filters.status === "available") query.status = "Available"
  else if (filters.status === "assigned") query.status = { $in: ["Financed", "Reserved"] }
  else if (filters.status === "maintenance") query.status = "Maintenance"
  else if (filters.status === "retired") query.status = "Retired"

  // Contract filter resolves vehicle display names by contract status, then
  // narrows the vehicle query to those names.
  if (["active", "completed", "defaulted"].includes(filters.contract)) {
    const names = await HirePurchaseContract.distinct("vehicleDisplayName", {
      status: filters.contract.toUpperCase(),
    })
    query.name = { $in: names }
  } else if (filters.contract === "none") {
    const names = await HirePurchaseContract.distinct("vehicleDisplayName")
    query.name = { $nin: names }
  }

  const totalCount = await Vehicle.countDocuments(query)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const vehicles = await Vehicle.find(query)
    .populate("driverId", "name fullName email")
    .sort({ addedDate: -1 })
    .skip((currentPage - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean()

  // Resolve the operational contract for each vehicle on this page.
  const vehicleNames = vehicles.map((vehicle: any) => vehicle.name).filter(Boolean)
  const contracts = vehicleNames.length
    ? await HirePurchaseContract.find({ vehicleDisplayName: { $in: vehicleNames } })
        .select("vehicleDisplayName status totalPaidNgn totalPayableNgn nextDueDate createdAt")
        .sort({ createdAt: -1 })
        .lean()
    : []

  const contractsByName = new Map<string, any[]>()
  for (const contract of contracts) {
    const list = contractsByName.get(contract.vehicleDisplayName) || []
    list.push(contract)
    contractsByName.set(contract.vehicleDisplayName, list)
  }

  const rows = vehicles.map((vehicle: any) => {
    const statusLabel = normalizeVehicleStatus(vehicle.status)
    const contract = pickOperationalContract(contractsByName.get(vehicle.name) || [])
    const percent = contract ? repaymentPercent(contract.totalPaidNgn, contract.totalPayableNgn) : null
    return {
      id: vehicle._id.toString(),
      name: vehicle.name as string,
      type: (vehicle.type as string) || "N/A",
      identifier: (vehicle.identifier || vehicle.specifications?.vin || "—") as string,
      statusLabel,
      driver: driverLabel(vehicle.driverId),
      contractStatus: (contract?.status as string) || null,
      percent,
      nextDue: contract?.nextDueDate as Date | undefined,
    }
  })

  const from = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const to = Math.min(currentPage * PAGE_SIZE, totalCount)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Operations"
        subtitle="Track vehicles, driver assignments, contracts, and repayment performance across the fleet."
        actions={
          <form
            action="/dashboard/admin/fleet-operations"
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          >
            <div className="relative min-w-[220px] flex-1 sm:w-[260px] sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={filters.q} placeholder="Search name or identifier" className="h-9 pl-9" />
            </div>
            <select
              name="status"
              defaultValue={filters.status}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="all">All status</option>
              <option value="available">Available</option>
              <option value="assigned">Assigned</option>
              <option value="maintenance">Under Maintenance</option>
              <option value="retired">Retired</option>
            </select>
            <select
              name="type"
              defaultValue={filters.type}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="all">All types</option>
              <option value="KEKE">KEKE</option>
              <option value="SHUTTLE">SHUTTLE</option>
            </select>
            <select
              name="contract"
              defaultValue={filters.contract}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="all">All contracts</option>
              <option value="active">Active contract</option>
              <option value="completed">Completed contract</option>
              <option value="defaulted">Defaulted contract</option>
              <option value="none">No contract</option>
            </select>
            <Button type="submit" variant="outline" className="h-9">
              Filter
            </Button>
          </form>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Fleet Size" value={fleetSize} hint={`${retiredCount} retired`} />
        <MetricCard label="Available" value={availableCount} />
        <MetricCard label="Assigned" value={assignedCount} />
        <MetricCard label="In Maintenance" value={maintenanceCount} />
        <MetricCard label="Active Contracts" value={activeContracts} />
        <MetricCard label="Avg Repayment" value={formatPercent(avgRepayment, 0)} hint="Active contracts" />
        <MetricCard label="Fleet Value" value={formatNaira(fleetValue)} hint="Excludes retired" />
        <MetricCard label="Total Collected" value={formatNaira(totalCollected)} hint="Confirmed repayments" />
      </section>

      <section className="rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Showing {from} to {to} of {totalCount} vehicles
          </p>
          <p>
            Page {currentPage} of {totalPages}
          </p>
        </div>

        {/* Mobile cards */}
        <div className="divide-y divide-border/60 md:hidden">
          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No vehicles match these filters.
            </div>
          ) : (
            rows.map((row) => (
              <article key={row.id} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.type} · {row.identifier}
                    </p>
                  </div>
                  <Badge variant="default" className={cn(vehicleStatusBadgeClass(row.statusLabel))}>
                    {row.statusLabel}
                  </Badge>
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <p>Driver: {row.driver}</p>
                  <p>
                    Contract:{" "}
                    {row.contractStatus ? (
                      <Badge variant="default" className={cn("align-middle", contractStatusBadgeClass(row.contractStatus))}>
                        {row.contractStatus}
                      </Badge>
                    ) : (
                      "No contract"
                    )}
                  </p>
                  <p>Next due: {formatDate(row.nextDue)}</p>
                </div>
                {row.percent !== null ? <RepaymentBar percent={row.percent} status={row.contractStatus} /> : null}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={`/dashboard/admin/fleet-operations/${row.id}`}>
                    <Eye className="mr-2 h-4 w-4" />
                    View details
                  </Link>
                </Button>
              </article>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden max-h-[calc(100vh-440px)] overflow-auto md:block">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/65">
              <tr className="border-b border-border/70 text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Vehicle</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Assigned Driver</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Contract</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Repayment</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Next Due</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No vehicles match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.type} · {row.identifier}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="default" className={cn(vehicleStatusBadgeClass(row.statusLabel))}>
                        {row.statusLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.driver}</td>
                    <td className="px-4 py-3">
                      {row.contractStatus ? (
                        <Badge variant="default" className={cn(contractStatusBadgeClass(row.contractStatus))}>
                          {row.contractStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">No contract</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.percent !== null ? (
                        <RepaymentBar percent={row.percent} status={row.contractStatus} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(row.nextDue)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild variant="ghost" size="sm" className="h-8">
                        <Link href={`/dashboard/admin/fleet-operations/${row.id}`}>
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn(currentPage <= 1 ? "pointer-events-none opacity-50" : "")}
          >
            <Link href={buildFleetHref(filters, Math.max(1, currentPage - 1))}>Previous</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn(currentPage >= totalPages ? "pointer-events-none opacity-50" : "")}
          >
            <Link href={buildFleetHref(filters, Math.min(totalPages, currentPage + 1))}>Next</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
