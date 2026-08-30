import dbConnect from "@/lib/dbConnect"
import VehicleMaintenanceOrder, { MaintenanceState } from "@/models/VehicleMaintenanceOrder"
import VehicleInspection from "@/models/VehicleInspection"
import Vehicle from "@/models/Vehicle"

const VALID_TRANSITIONS: Record<MaintenanceState, MaintenanceState[]> = {
  reported: ["triaged", "cancelled"],
  triaged: ["approved", "cancelled"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["verified"],
  verified: [],
  cancelled: [],
}

/**
 * Validates whether a state transition is permitted by the maintenance lifecycle state machine.
 */
export function validateStateTransition(
  currentState: MaintenanceState,
  targetState: MaintenanceState,
): boolean {
  if (currentState === targetState) return true
  const allowed = VALID_TRANSITIONS[currentState] || []
  return allowed.includes(targetState)
}

/**
 * Transition work order state with validation and side effects.
 */
export async function transitionMaintenanceState(
  orderId: string,
  targetState: MaintenanceState,
  actorUserId?: string,
  notes?: string,
) {
  await dbConnect()

  const order = await VehicleMaintenanceOrder.findById(orderId)
  if (!order) {
    throw new Error(`Maintenance order ${orderId} not found`)
  }

  if (!validateStateTransition(order.state, targetState)) {
    throw new Error(
      `Invalid maintenance state transition from '${order.state}' to '${targetState}'`,
    )
  }

  order.state = targetState

  if (targetState === "in_progress") {
    // Automatically set vehicle status to Maintenance
    await Vehicle.findByIdAndUpdate(order.vehicleId, { status: "Maintenance" })
  } else if (targetState === "completed") {
    order.completionDate = new Date()
  } else if (targetState === "verified") {
    order.verifiedDate = new Date()
    if (actorUserId) {
      order.verifiedByUserId = actorUserId as any
    }
  }

  if (notes) {
    order.internalNotes = order.internalNotes
      ? `${order.internalNotes}\n[${targetState}]: ${notes}`
      : `[${targetState}]: ${notes}`
  }

  await order.save()
  return order
}

/**
 * Modifies estimated maintenance cost and appends audit trail.
 */
export async function adjustMaintenanceCost(
  orderId: string,
  newEstimate: number,
  reason: string,
  adjustedByUserId: string,
) {
  await dbConnect()

  const order = await VehicleMaintenanceOrder.findById(orderId)
  if (!order) {
    throw new Error(`Maintenance order ${orderId} not found`)
  }

  const previousEstimate = order.estimatedCostNgn || 0
  order.costAdjustmentHistory.push({
    previousEstimate,
    newEstimate,
    reason,
    adjustedByUserId: adjustedByUserId as any,
    timestamp: new Date(),
  })
  order.estimatedCostNgn = newEstimate

  await order.save()
  return order
}

/**
 * Authorizes return-to-service for a vehicle after successful inspection.
 */
export async function authorizeReturnToService(
  inspectionId: string,
  authorizerUserId: string,
  notes?: string,
) {
  await dbConnect()

  const inspection = await VehicleInspection.findById(inspectionId)
  if (!inspection) {
    throw new Error(`Inspection ${inspectionId} not found`)
  }

  if (inspection.inspectionType !== "return_to_service") {
    throw new Error(`Inspection ${inspectionId} is not of type 'return_to_service'`)
  }

  if (inspection.overallResult !== "passed" || inspection.hasCriticalFailure) {
    throw new Error(`Cannot authorize return-to-service: Inspection result must be 'passed' with zero critical failures`)
  }

  inspection.returnToServiceAuthorizedBy = authorizerUserId as any
  inspection.returnToServiceNotes = notes
  await inspection.save()

  // Update vehicle status back to Available or Financed
  const vehicle = await Vehicle.findById(inspection.vehicleId)
  if (vehicle) {
    const targetStatus = vehicle.driverId ? "Financed" : "Available"
    vehicle.status = targetStatus
    vehicle.hasActiveDowntime = false
    await vehicle.save()
  }

  return inspection
}
