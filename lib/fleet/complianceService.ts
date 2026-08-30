import dbConnect from "@/lib/dbConnect"
import VehicleDocument from "@/models/VehicleDocument"
import VehicleInspection from "@/models/VehicleInspection"
import VehicleInsurancePolicy from "@/models/VehicleInsurancePolicy"
import Vehicle from "@/models/Vehicle"

export interface ExpiryEvaluation {
  isExpired: boolean
  isExpiringSoon: boolean
  daysRemaining: number
}

/**
 * Calculates document expiry status relative to current time or target reference date.
 */
export function calculateDocumentExpiry(
  expiryDate: Date,
  warningDays = 30,
  referenceDate = new Date(),
): ExpiryEvaluation {
  const expiryTime = new Date(expiryDate).getTime()
  const refTime = new Date(referenceDate).getTime()
  const diffMs = expiryTime - refTime
  const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  return {
    isExpired: daysRemaining < 0,
    isExpiringSoon: daysRemaining >= 0 && daysRemaining <= warningDays,
    daysRemaining,
  }
}

export interface VehicleComplianceSummary {
  complianceStatus: "compliant" | "warning" | "non_compliant" | "uninspected"
  expiredDocumentsCount: number
  expiringSoonDocumentsCount: number
  hasActiveInsurance: boolean
  hasCriticalInspectionFailure: boolean
  blockingReasons: string[]
}

/**
 * Evaluates full operational compliance for a vehicle.
 */
export async function evaluateVehicleCompliance(
  vehicleId: string,
): Promise<VehicleComplianceSummary> {
  await dbConnect()

  const blockingReasons: string[] = []
  const docs = await VehicleDocument.find({ vehicleId }).lean()

  let expiredDocumentsCount = 0
  let expiringSoonDocumentsCount = 0

  for (const doc of docs) {
    const evalResult = calculateDocumentExpiry(doc.expiryDate)
    if (evalResult.isExpired || doc.verificationStatus === "expired") {
      expiredDocumentsCount++
      blockingReasons.push(`Document '${doc.title}' (${doc.documentType}) is expired`)
    } else if (evalResult.isExpiringSoon) {
      expiringSoonDocumentsCount++
    }
  }

  // Check Insurance
  const now = new Date()
  const activeInsurance = await VehicleInsurancePolicy.findOne({
    vehicleId,
    status: "active",
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).lean()

  const hasActiveInsurance = Boolean(activeInsurance)
  if (!hasActiveInsurance) {
    blockingReasons.push("No active insurance policy found covering the current date")
  }

  // Check Inspections
  const latestInspection = await VehicleInspection.findOne({ vehicleId })
    .sort({ inspectionDate: -1 })
    .lean()

  let hasCriticalInspectionFailure = false
  if (latestInspection) {
    if (latestInspection.overallResult === "failed" || latestInspection.hasCriticalFailure) {
      hasCriticalInspectionFailure = true
      blockingReasons.push(
        `Latest inspection (${latestInspection.inspectionType}) failed with critical issues`,
      )
    }
  }

  let complianceStatus: "compliant" | "warning" | "non_compliant" | "uninspected" = "compliant"
  if (!latestInspection) {
    complianceStatus = "uninspected"
  } else if (expiredDocumentsCount > 0 || !hasActiveInsurance || hasCriticalInspectionFailure) {
    complianceStatus = "non_compliant"
  } else if (expiringSoonDocumentsCount > 0) {
    complianceStatus = "warning"
  }

  // Update vehicle cached summary status
  await Vehicle.findByIdAndUpdate(vehicleId, { complianceStatus })

  return {
    complianceStatus,
    expiredDocumentsCount,
    expiringSoonDocumentsCount,
    hasActiveInsurance,
    hasCriticalInspectionFailure,
    blockingReasons,
  }
}

/**
 * Determines whether a vehicle is legally & operationally eligible to transition to 'Available' or 'Financed'.
 */
export async function canActivateVehicle(
  vehicleId: string,
): Promise<{ allowed: boolean; reasons: string[] }> {
  const summary = await evaluateVehicleCompliance(vehicleId)
  const allowed = summary.blockingReasons.length === 0 && summary.complianceStatus !== "non_compliant"

  return {
    allowed,
    reasons: summary.blockingReasons,
  }
}
