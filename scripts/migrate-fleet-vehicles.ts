import dbConnect from "../lib/dbConnect"
import Vehicle from "../models/Vehicle"
import VehicleInspection from "../models/VehicleInspection"
import VehicleOdometerReading from "../models/VehicleOdometerReading"

export async function migrateLegacyVehicles() {
  await dbConnect()

  console.log("[Migration] Starting legacy vehicle fleet operational migration...")
  const vehicles = await Vehicle.find({})
  let migratedCount = 0

  for (const vehicle of vehicles) {
    let updated = false

    if (!vehicle.complianceStatus) {
      vehicle.complianceStatus = "uninspected"
      updated = true
    }

    if (vehicle.currentOdometerKm === undefined || vehicle.currentOdometerKm === null) {
      const parsedMileage = vehicle.specifications?.mileage
        ? parseInt(vehicle.specifications.mileage.replace(/\D/g, ""), 10) || 0
        : 0
      vehicle.currentOdometerKm = parsedMileage
      updated = true
    }

    if (vehicle.hasActiveDowntime === undefined || vehicle.hasActiveDowntime === null) {
      vehicle.hasActiveDowntime = vehicle.status === "Maintenance"
      updated = true
    }

    if (updated) {
      await vehicle.save()
      migratedCount++
    }

    // Create baseline odometer record if none exists
    const existingOdometer = await VehicleOdometerReading.findOne({ vehicleId: vehicle._id })
    if (!existingOdometer) {
      await VehicleOdometerReading.create({
        vehicleId: vehicle._id,
        readingKm: vehicle.currentOdometerKm || 0,
        recordedAt: vehicle.addedDate || new Date(),
        source: "manual_admin",
        notes: "Legacy vehicle migration baseline odometer reading",
      })
    }

    // Create baseline pre-delivery inspection if none exists
    const existingInspection = await VehicleInspection.findOne({ vehicleId: vehicle._id })
    if (!existingInspection) {
      await VehicleInspection.create({
        vehicleId: vehicle._id,
        inspectionType: "pre_delivery",
        inspectorName: "System Migration Engine",
        inspectionDate: vehicle.addedDate || new Date(),
        overallResult: "passed",
        hasCriticalFailure: false,
        checklist: [
          { category: "Engine", item: "Engine Check", passed: true, isCritical: true },
          { category: "Brakes", item: "Brake System Check", passed: true, isCritical: true },
          { category: "Tires", item: "Tire Condition", passed: true, isCritical: false },
        ],
        odometerReading: vehicle.currentOdometerKm || 0,
      })
    }
  }

  console.log(`[Migration] Completed fleet vehicle migration. Processed ${vehicles.length} vehicles (${migratedCount} updated).`)
  return { totalVehicles: vehicles.length, migratedCount }
}

if (require.main === module) {
  migrateLegacyVehicles()
    .then((res) => {
      console.log("[Migration Success]", res)
      process.exit(0)
    })
    .catch((err) => {
      console.error("[Migration Error]", err)
      process.exit(1)
    })
}
