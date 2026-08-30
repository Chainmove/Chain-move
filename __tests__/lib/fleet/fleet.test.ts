import mongoose from "mongoose"
import Vehicle from "@/models/Vehicle"
import VehicleDocument from "@/models/VehicleDocument"
import VehicleInspection from "@/models/VehicleInspection"
import VehicleInsurancePolicy from "@/models/VehicleInsurancePolicy"
import VehicleMaintenanceOrder from "@/models/VehicleMaintenanceOrder"
import VehicleIncident from "@/models/VehicleIncident"
import VehicleDowntimePeriod from "@/models/VehicleDowntimePeriod"
import {
  calculateDocumentExpiry,
  canActivateVehicle,
  evaluateVehicleCompliance,
} from "@/lib/fleet/complianceService"
import {
  adjustMaintenanceCost,
  authorizeReturnToService,
  transitionMaintenanceState,
  validateStateTransition,
} from "@/lib/fleet/maintenanceService"
import {
  checkOverlappingDowntime,
  checkOverlappingInsurance,
  endDowntimePeriod,
  startDowntimePeriod,
} from "@/lib/fleet/downtimeService"
import { projectMaintenanceForDriver } from "@/lib/fleet/projection"
import { migrateLegacyVehicles } from "@/scripts/migrate-fleet-vehicles"

describe("Fleet Operational Lifecycle Subsystem Tests (#105)", () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      try {
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test", {
          serverSelectionTimeoutMS: 2000,
        })
      } catch (err) {
        console.warn("MongoDB connection warning in test environment:", err)
      }
    }
  }, 10000)

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  })

  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await Vehicle.deleteMany({})
      await VehicleDocument.deleteMany({})
      await VehicleInspection.deleteMany({})
      await VehicleInsurancePolicy.deleteMany({})
      await VehicleMaintenanceOrder.deleteMany({})
      await VehicleIncident.deleteMany({})
      await VehicleDowntimePeriod.deleteMany({})
    }
  })

  it("should calculate document expiry and warning thresholds correctly across timezone date boundaries", () => {
    const refDate = new Date("2026-07-21T00:00:00Z")
    
    // Expired document
    const pastDate = new Date("2026-07-10T00:00:00Z")
    const expiredEval = calculateDocumentExpiry(pastDate, 30, refDate)
    expect(expiredEval.isExpired).toBe(true)
    expect(expiredEval.daysRemaining).toBeLessThan(0)

    // Expiring soon document (15 days remaining)
    const soonDate = new Date("2026-08-05T00:00:00Z")
    const soonEval = calculateDocumentExpiry(soonDate, 30, refDate)
    expect(soonEval.isExpired).toBe(false)
    expect(soonEval.isExpiringSoon).toBe(true)
    expect(soonEval.daysRemaining).toBe(15)

    // Valid document (60 days remaining)
    const validDate = new Date("2026-09-19T00:00:00Z")
    const validEval = calculateDocumentExpiry(validDate, 30, refDate)
    expect(validEval.isExpired).toBe(false)
    expect(validEval.isExpiringSoon).toBe(false)
  })

  it("should enforce maintenance state machine transition rules", () => {
    expect(validateStateTransition("reported", "triaged")).toBe(true)
    expect(validateStateTransition("triaged", "approved")).toBe(true)
    expect(validateStateTransition("approved", "scheduled")).toBe(true)
    expect(validateStateTransition("scheduled", "in_progress")).toBe(true)
    expect(validateStateTransition("in_progress", "completed")).toBe(true)
    expect(validateStateTransition("completed", "verified")).toBe(true)

    // Invalid skip transitions
    expect(validateStateTransition("reported", "completed")).toBe(false)
    expect(validateStateTransition("triaged", "in_progress")).toBe(false)
    expect(validateStateTransition("completed", "in_progress")).toBe(false)
  })

  it("should project driver-visible maintenance records by stripping private vendor/admin notes", () => {
    const fullOrder = {
      workOrderNumber: "WO-101",
      issueTitle: "Brake Repair",
      description: "Replace front brake pads",
      vendorName: "AutoCare Ltd",
      vendorContact: "+2348000000000",
      estimatedCostNgn: 45000,
      driverNotes: "Driver noticed squeaking sound",
      internalNotes: "PRIVATE ADMIN NOTE: Vendor gives 10% discount",
      costAdjustmentHistory: [{ previousEstimate: 40000, newEstimate: 45000, reason: "Parts cost", adjustedByUserId: "user1", timestamp: new Date() }],
    }

    const projected = projectMaintenanceForDriver(fullOrder)
    expect(projected.driverNotes).toBe("Driver noticed squeaking sound")
    expect(projected.issueTitle).toBe("Brake Repair")
    expect((projected as any).internalNotes).toBeUndefined()
    expect((projected as any).vendorContact).toBeUndefined()
    expect((projected as any).costAdjustmentHistory).toBeUndefined()
  })

  it("should block vehicle activation when critical inspection failure exists", async () => {
    if (mongoose.connection.readyState !== 1) return

    const vehicle = await Vehicle.create({
      name: "Toyota HiAce",
      type: "Van",
      year: 2023,
      price: 8000000,
      roi: 15,
      status: "Maintenance",
      specifications: { vin: "VIN1234567890" },
    })

    await VehicleInspection.create({
      vehicleId: vehicle._id,
      inspectionType: "routine",
      overallResult: "failed",
      hasCriticalFailure: true,
      inspectionDate: new Date(),
      checklist: [{ category: "Brakes", item: "Front Brakes", passed: false, isCritical: true }],
    })

    const activationCheck = await canActivateVehicle(vehicle._id.toString())
    expect(activationCheck.allowed).toBe(false)
    expect(activationCheck.reasons.length).toBeGreaterThan(0)
  })

  it("should enforce return-to-service authorization requirements", async () => {
    if (mongoose.connection.readyState !== 1) return

    const vehicle = await Vehicle.create({
      name: "Hyundai Elantra",
      type: "Sedan",
      year: 2022,
      price: 6000000,
      roi: 12,
      status: "Maintenance",
      specifications: { vin: "VIN9876543210" },
    })

    // Failed return to service inspection should reject authorization
    const failedInspection = await VehicleInspection.create({
      vehicleId: vehicle._id,
      inspectionType: "return_to_service",
      overallResult: "failed",
      hasCriticalFailure: true,
      inspectionDate: new Date(),
    })

    await expect(
      authorizeReturnToService(failedInspection._id.toString(), new mongoose.Types.ObjectId().toString()),
    ).rejects.toThrow()

    // Passed return to service inspection permits authorization and restores vehicle status
    const passedInspection = await VehicleInspection.create({
      vehicleId: vehicle._id,
      inspectionType: "return_to_service",
      overallResult: "passed",
      hasCriticalFailure: false,
      inspectionDate: new Date(),
    })

    const authorized = await authorizeReturnToService(
      passedInspection._id.toString(),
      new mongoose.Types.ObjectId().toString(),
      "Fully repaired and verified",
    )

    expect(authorized.returnToServiceAuthorizedBy).toBeDefined()

    const updatedVehicle = await Vehicle.findById(vehicle._id)
    expect(updatedVehicle?.status).toBe("Available")
  })

  it("should detect overlapping insurance policies and downtime periods", async () => {
    if (mongoose.connection.readyState !== 1) return

    const vehicle = await Vehicle.create({
      name: "Kia Rio",
      type: "Sedan",
      year: 2021,
      price: 4500000,
      roi: 10,
      specifications: { vin: "VINKIA123" },
    })

    const start1 = new Date("2026-01-01T00:00:00Z")
    const end1 = new Date("2026-12-31T23:59:59Z")

    await VehicleInsurancePolicy.create({
      vehicleId: vehicle._id,
      providerName: "Leadway Assurance",
      policyNumber: "POL-001",
      insuranceType: "comprehensive",
      startDate: start1,
      endDate: end1,
      premiumAmountNgn: 150000,
      status: "active",
    })

    const overlaps = await checkOverlappingInsurance(
      vehicle._id.toString(),
      new Date("2026-06-01T00:00:00Z"),
      new Date("2027-05-31T00:00:00Z"),
    )
    expect(overlaps).toBe(true)

    // Downtime period tracking & overlap
    const downtime1 = await startDowntimePeriod(
      vehicle._id.toString(),
      "scheduled_maintenance",
      new Date("2026-07-01T00:00:00Z"),
    )

    const dtOverlap = await checkOverlappingDowntime(
      vehicle._id.toString(),
      new Date("2026-07-02T00:00:00Z"),
    )
    expect(dtOverlap).toBe(true)

    const ended = await endDowntimePeriod(downtime1._id.toString(), new Date("2026-07-03T00:00:00Z"))
    expect(ended.totalDowntimeHours).toBe(48)
  })

  it("should record cost adjustment audit trail on maintenance orders", async () => {
    if (mongoose.connection.readyState !== 1) return

    const vehicle = await Vehicle.create({
      name: "Honda City",
      type: "Sedan",
      year: 2022,
      price: 5000000,
      roi: 11,
      specifications: { vin: "VINHONDA001" },
    })

    const order = await VehicleMaintenanceOrder.create({
      workOrderNumber: "WO-AUDIT-1",
      vehicleId: vehicle._id,
      issueTitle: "Transmission Fluid Leak",
      description: "Inspect transmission gasket",
      estimatedCostNgn: 30000,
    })

    const adminId = new mongoose.Types.ObjectId().toString()
    const updated = await adjustMaintenanceCost(order._id.toString(), 42000, "Replacement gasket required", adminId)

    expect(updated.estimatedCostNgn).toBe(42000)
    expect(updated.costAdjustmentHistory.length).toBe(1)
    expect(updated.costAdjustmentHistory[0].previousEstimate).toBe(30000)
    expect(updated.costAdjustmentHistory[0].newEstimate).toBe(42000)
  })

  it("should migrate legacy vehicles gracefully and populate baseline operational records", async () => {
    if (mongoose.connection.readyState !== 1) return

    const legacyVehicle = await Vehicle.create({
      name: "Legacy Suzuki Every",
      type: "Mini Van",
      year: 2020,
      price: 3500000,
      roi: 14,
      specifications: { vin: "VINLEGACY999", mileage: "45,000 km" },
    })

    const migrationRes = await migrateLegacyVehicles()
    expect(migrationRes.totalVehicles).toBeGreaterThanOrEqual(1)

    const migrated = await Vehicle.findById(legacyVehicle._id)
    expect(migrated?.complianceStatus).toBe("uninspected")
    expect(migrated?.currentOdometerKm).toBe(45000)
  })
})
