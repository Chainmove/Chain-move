import mongoose from "mongoose"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import Loan from "@/models/Loan"
import InvariantFinding from "@/models/InvariantFinding"
import { runInvariantScan } from "@/lib/integrity/scanner"
import { applyRepair, previewRepair, suppressFinding } from "@/lib/integrity/repairEngine"
import { generateJsonSummary, redactPii } from "@/lib/integrity/reporting"

describe("Data Integrity Subsystem & Scanner Tests", () => {
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
      await User.deleteMany({})
      await Vehicle.deleteMany({})
      await Loan.deleteMany({})
      await InvariantFinding.deleteMany({})
    }
  })

  it("should redact PII fields correctly in objects and strings", () => {
    const rawData = {
      email: "john@example.com",
      phoneNumber: "+2348012345678",
      name: "John Doe",
      normalField: "Keep this text",
      nested: {
        address: "123 Main Street",
        text: "Contact user at alice@test.org or +1-555-0199",
      },
    }

    const redacted = redactPii(rawData)
    expect(redacted.email).toBe("[REDACTED]")
    expect(redacted.phoneNumber).toBe("[REDACTED]")
    expect(redacted.name).toBe("[REDACTED]")
    expect(redacted.normalField).toBe("Keep this text")
    expect(redacted.nested.address).toBe("[REDACTED]")
    expect(redacted.nested.text).toContain("[REDACTED_EMAIL]")
    expect(redacted.nested.text).toContain("[REDACTED_PHONE]")
  })

  it("should detect legacy field discrepancies and repair them", async () => {
    if (mongoose.connection.readyState !== 1) return
    const user = await User.create({
      name: "Legacy User",
      email: "legacy@example.com",
      role: "driver",
      isKycVerified: true,
      kycVerified: false,
    })

    const scanResult = await runInvariantScan({ ruleIds: ["INV_LEGACY_FIELDS_MISMATCH"] })
    expect(scanResult.findingsDetected).toBeGreaterThanOrEqual(1)

    const finding = await InvariantFinding.findOne({ ruleId: "INV_LEGACY_FIELDS_MISMATCH", primaryId: user._id.toString() })
    expect(finding).toBeDefined()
    expect(finding?.status).toBe("OPEN")

    const preview = await previewRepair(finding!._id.toString())
    expect(preview.strategy).toBe("SYNC_LEGACY_USER_FIELDS")
    expect(preview.proposedChanges.isKycVerified).toBe(true)

    const repairResult = await applyRepair(finding!._id.toString())
    expect(repairResult.success).toBe(true)
    expect(repairResult.status).toBe("REPAIRED")

    const updatedUser = await User.findById(user._id)
    expect(updatedUser?.kycVerified).toBe(true)
  })

  it("should detect vehicle status contradictions and repair them", async () => {
    if (mongoose.connection.readyState !== 1) return
    const driver = await User.create({
      name: "Driver One",
      email: "driver1@example.com",
      role: "driver",
    })

    const vehicle = await Vehicle.create({
      name: "Toyota Corolla",
      type: "Sedan",
      year: 2022,
      price: 5000000,
      roi: 12,
      status: "Available",
      fundingStatus: "Active",
      driverId: driver._id,
    })

    await Loan.create({
      driverId: driver._id,
      vehicleId: vehicle._id,
      requestedAmount: 5000000,
      totalFunded: 5000000,
      status: "Active",
      loanTerm: 12,
      monthlyPayment: 450000,
      interestRate: 10,
    })

    const scanResult = await runInvariantScan({ ruleIds: ["INV_VEHICLE_STATUS_CONTRADICTION"] })
    expect(scanResult.findingsDetected).toBe(1)

    const finding = await InvariantFinding.findOne({ ruleId: "INV_VEHICLE_STATUS_CONTRADICTION" })
    expect(finding).toBeDefined()

    const repairResult = await applyRepair(finding!._id.toString())
    expect(repairResult.success).toBe(true)

    const updatedVehicle = await Vehicle.findById(vehicle._id)
    expect(updatedVehicle?.status).toBe("Financed")
  })

  it("should deduplicate repeat scans and increment scanCount", async () => {
    if (mongoose.connection.readyState !== 1) return
    await User.create({
      name: "Legacy User 2",
      email: "legacy2@example.com",
      role: "investor",
      isKycVerified: true,
      kycVerified: false,
    })

    await runInvariantScan({ ruleIds: ["INV_LEGACY_FIELDS_MISMATCH"] })
    let finding = await InvariantFinding.findOne({ ruleId: "INV_LEGACY_FIELDS_MISMATCH" })
    expect(finding?.scanCount).toBe(1)

    await runInvariantScan({ ruleIds: ["INV_LEGACY_FIELDS_MISMATCH"] })
    finding = await InvariantFinding.findOne({ ruleId: "INV_LEGACY_FIELDS_MISMATCH" })
    expect(finding?.scanCount).toBe(2)
  })

  it("should allow false positive suppression with notes", async () => {
    if (mongoose.connection.readyState !== 1) return
    await User.create({
      name: "Legacy User 3",
      email: "legacy3@example.com",
      role: "investor",
      isKycVerified: true,
      kycVerified: false,
    })

    await runInvariantScan({ ruleIds: ["INV_LEGACY_FIELDS_MISMATCH"] })
    const finding = await InvariantFinding.findOne({ ruleId: "INV_LEGACY_FIELDS_MISMATCH" })

    const suppressed = await suppressFinding(finding!._id.toString(), "Known legacy exception", "test_admin")
    expect(suppressed.status).toBe("SUPPRESSED")
    expect(suppressed.suppressionReason).toBe("Known legacy exception")
    expect(suppressed.suppressedBy).toBe("test_admin")
  })

  it("should generate JSON summaries with PII redacted", async () => {
    const rawFindings = [
      {
        fingerprint: "fp123",
        ruleId: "INV_LEGACY_FIELDS_MISMATCH",
        severity: "MEDIUM",
        category: "SCHEMA_DEPRECATION",
        primaryModel: "User",
        primaryId: "123",
        explanation: "User john@example.com (+2348000000000) has legacy issue",
        repairability: "AUTOMATIC",
        status: "OPEN",
      },
    ]

    const summary = generateJsonSummary(rawFindings as any)
    expect(summary.totalFindings).toBe(1)
    expect(summary.findings[0].explanation).toContain("[REDACTED_EMAIL]")
    expect(summary.findings[0].explanation).toContain("[REDACTED_PHONE]")
  })

  it("should detect and repair invalid Stellar public key encoding", async () => {
    if (mongoose.connection.readyState !== 1) return

    const user = await User.create({
      name: "Stellar User",
      email: "stellar@example.com",
      role: "investor",
      stellarPublicKey: "INVALID_G_KEY_12345",
    })

    const scanResult = await runInvariantScan({ ruleIds: ["INV_INVALID_STELLAR_KEYS"] })
    expect(scanResult.findingsDetected).toBe(1)

    const finding = await InvariantFinding.findOne({ ruleId: "INV_INVALID_STELLAR_KEYS", primaryId: user._id.toString() })
    expect(finding).toBeDefined()

    const repairResult = await applyRepair(finding!._id.toString())
    expect(repairResult.success).toBe(true)

    const updatedUser = await User.findById(user._id)
    expect(updatedUser?.stellarPublicKey).toBeNull()
  })
})
