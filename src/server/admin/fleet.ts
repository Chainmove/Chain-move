// Shared, presentation-level helpers for the admin fleet operations dashboard.
// Centralised here so the fleet list view and the vehicle detail view share the
// same status normalisation and repayment maths instead of duplicating it.

export type FleetStatusLabel =
  | "Available"
  | "Assigned"
  | "Under Maintenance"
  | "Retired"

export type VehicleStatus =
  | "Available"
  | "Financed"
  | "Reserved"
  | "Maintenance"
  | "Retired"

export type ContractStatus = "ACTIVE" | "COMPLETED" | "DEFAULTED"

// Map the raw Vehicle.status enum to an operations-facing label.
export function normalizeVehicleStatus(status?: string | null): FleetStatusLabel {
  const normalized = (status || "").toLowerCase()
  if (normalized === "maintenance") return "Under Maintenance"
  if (normalized === "retired") return "Retired"
  if (normalized === "financed" || normalized === "reserved") return "Assigned"
  return "Available"
}

export function vehicleStatusBadgeClass(label: FleetStatusLabel): string {
  if (label === "Assigned") return "bg-blue-600 text-white hover:bg-blue-600"
  if (label === "Under Maintenance") return "bg-amber-600 text-white hover:bg-amber-600"
  if (label === "Retired") return "bg-zinc-600 text-white hover:bg-zinc-600"
  return "bg-green-600 text-white hover:bg-green-600"
}

export function contractStatusBadgeClass(status?: string | null): string {
  const value = (status || "").toUpperCase()
  if (value === "COMPLETED") return "bg-green-600 text-white hover:bg-green-600"
  if (value === "DEFAULTED") return "bg-red-600 text-white hover:bg-red-600"
  if (value === "ACTIVE") return "bg-blue-600 text-white hover:bg-blue-600"
  return "bg-zinc-600 text-white hover:bg-zinc-600"
}

// Repayment completion as an integer percentage, clamped to [0, 100].
export function repaymentPercent(
  paid?: number | null,
  payable?: number | null,
): number {
  const paidValue = Number(paid || 0)
  const payableValue = Number(payable || 0)
  if (payableValue <= 0) return 0
  const pct = (paidValue / payableValue) * 100
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, Math.round(pct)))
}

// Colour for the repayment progress bar based on completion + contract health.
export function repaymentBarClass(percent: number, status?: string | null): string {
  if ((status || "").toUpperCase() === "DEFAULTED") return "bg-red-500"
  if (percent >= 100) return "bg-green-500"
  if (percent >= 50) return "bg-blue-500"
  return "bg-amber-500"
}

// Pick the contract that best represents a vehicle's current operational state:
// prefer an ACTIVE contract, otherwise fall back to the most recent one.
// `contracts` is expected to be pre-sorted by createdAt descending.
export function pickOperationalContract<T extends { status?: string }>(
  contracts: T[],
): T | null {
  if (contracts.length === 0) return null
  const active = contracts.find((c) => (c.status || "").toUpperCase() === "ACTIVE")
  return active ?? contracts[0]
}
