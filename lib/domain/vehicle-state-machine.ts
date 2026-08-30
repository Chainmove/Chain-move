export type VehicleStatus = "Available" | "Reserved" | "Financed" | "Maintenance" | "Retired"
export type VehicleFundingStatus = "Open" | "Funded" | "Active"
export type VehicleActorType = "admin" | "system"

/**
 * Authoritative transition table for vehicle operational status.
 *
 * Retired is terminal. Available is the natural resting state reached after
 * loan completion, reservation release, or maintenance exit.
 */
export const VEHICLE_VALID_TRANSITIONS: Record<VehicleStatus, VehicleStatus[]> = {
  Available: ["Reserved", "Maintenance", "Retired"],
  Reserved: ["Available", "Financed", "Maintenance"],
  Financed: ["Available", "Maintenance", "Retired"],
  Maintenance: ["Available", "Retired"],
  Retired: [],
}

// Which actors may initiate a transition INTO the given target status.
export const VEHICLE_TRANSITION_ACTORS: Record<VehicleStatus, VehicleActorType[]> = {
  Available: ["admin", "system"],
  Reserved: ["admin", "system"],
  Financed: ["admin", "system"],
  Maintenance: ["admin"],
  Retired: ["admin"],
}

/**
 * Authoritative transition table for vehicle funding status.
 * Open -> Funded when the vehicle's price is fully covered by investments.
 * Funded -> Active when the loan activates.
 * Active -> Funded is an admin override for loan cancellations post-funding.
 * Funded -> Open when investments are rolled back (loan rejected while funded).
 */
export const VEHICLE_FUNDING_TRANSITIONS: Record<VehicleFundingStatus, VehicleFundingStatus[]> = {
  Open: ["Funded"],
  Funded: ["Active", "Open"],
  Active: ["Funded"],
}

export function isValidVehicleTransition(
  from: VehicleStatus | null,
  to: VehicleStatus,
): boolean {
  if (!from) return true
  if (from === to) return true
  return (VEHICLE_VALID_TRANSITIONS[from] || []).includes(to)
}

export function isVehicleActorAllowed(
  targetState: VehicleStatus,
  actorType: VehicleActorType,
): boolean {
  return (VEHICLE_TRANSITION_ACTORS[targetState] || []).includes(actorType)
}

export function isValidVehicleFundingTransition(
  from: VehicleFundingStatus,
  to: VehicleFundingStatus,
): boolean {
  if (from === to) return true
  return (VEHICLE_FUNDING_TRANSITIONS[from] || []).includes(to)
}

export function isTerminalVehicleStatus(status: VehicleStatus): boolean {
  return status === "Retired"
}
