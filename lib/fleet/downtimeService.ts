import dbConnect from "@/lib/dbConnect"
import VehicleDowntimePeriod, { DowntimeReason, IVehicleDowntimePeriod } from "@/models/VehicleDowntimePeriod"
import VehicleInsurancePolicy from "@/models/VehicleInsurancePolicy"
import Vehicle from "@/models/Vehicle"

/**
 * Detects overlapping insurance policy dates for a vehicle.
 */
export async function checkOverlappingInsurance(
  vehicleId: string,
  startDate: Date,
  endDate: Date,
  excludePolicyId?: string,
): Promise<boolean> {
  await dbConnect()

  const query: any = {
    vehicleId,
    status: { $ne: "cancelled" },
    $or: [
      { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
    ],
  }

  if (excludePolicyId) {
    query._id = { $ne: excludePolicyId }
  }

  const count = await VehicleInsurancePolicy.countDocuments(query)
  return count > 0
}

/**
 * Detects overlapping active downtime periods for a vehicle.
 */
export async function checkOverlappingDowntime(
  vehicleId: string,
  startTime: Date,
  endTime?: Date,
  excludeDowntimeId?: string,
): Promise<boolean> {
  await dbConnect()

  const refEnd = endTime || new Date(8640000000000000)

  const query: any = {
    vehicleId,
    $or: [
      {
        startTime: { $lte: refEnd },
        $or: [{ endTime: { $gte: startTime } }, { endTime: null }],
      },
    ],
  }

  if (excludeDowntimeId) {
    query._id = { $ne: excludeDowntimeId }
  }

  const count = await VehicleDowntimePeriod.countDocuments(query)
  return count > 0
}

/**
 * Starts a new tracked downtime period for a vehicle.
 */
export async function startDowntimePeriod(
  vehicleId: string,
  reason: DowntimeReason,
  startTime = new Date(),
  driverUserId?: string,
  contractId?: string,
  maintenanceOrderId?: string,
  incidentId?: string,
  notes?: string,
): Promise<IVehicleDowntimePeriod> {
  await dbConnect()

  const hasOverlap = await checkOverlappingDowntime(vehicleId, startTime)
  if (hasOverlap) {
    throw new Error(`Vehicle ${vehicleId} already has an active or overlapping downtime period`)
  }

  const period = await VehicleDowntimePeriod.create({
    vehicleId,
    driverUserId,
    contractId,
    maintenanceOrderId,
    incidentId,
    startTime,
    reason,
    notes,
    repaymentPolicyEffect: "no_pause",
  })

  // Mark vehicle as active downtime
  await Vehicle.findByIdAndUpdate(vehicleId, { hasActiveDowntime: true })

  return period
}

/**
 * Ends an active downtime period and calculates total downtime hours.
 */
export async function endDowntimePeriod(
  downtimeId: string,
  endTime = new Date(),
): Promise<IVehicleDowntimePeriod> {
  await dbConnect()

  const period = await VehicleDowntimePeriod.findById(downtimeId)
  if (!period) {
    throw new Error(`Downtime period ${downtimeId} not found`)
  }

  if (period.endTime) {
    throw new Error(`Downtime period ${downtimeId} is already ended`)
  }

  period.endTime = endTime
  const diffMs = endTime.getTime() - new Date(period.startTime).getTime()
  period.totalDowntimeHours = Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10)

  await period.save()

  // Check if any other open downtime remains for this vehicle
  const remainingOpen = await VehicleDowntimePeriod.countDocuments({
    vehicleId: period.vehicleId,
    endTime: null,
  })

  if (remainingOpen === 0) {
    await Vehicle.findByIdAndUpdate(period.vehicleId, { hasActiveDowntime: false })
  }

  return period
}
