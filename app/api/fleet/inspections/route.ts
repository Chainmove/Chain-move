import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import VehicleInspection from "@/models/VehicleInspection"
import { authorizeReturnToService } from "@/lib/fleet/maintenanceService"
import { evaluateVehicleCompliance } from "@/lib/fleet/complianceService"

export async function GET(request: Request) {
  try {
    await dbConnect()
    const { searchParams } = new URL(request.url)
    const vehicleId = searchParams.get("vehicleId")

    const filter = vehicleId ? { vehicleId } : {}
    const inspections = await VehicleInspection.find(filter)
      .sort({ inspectionDate: -1 })
      .lean()

    return NextResponse.json({ success: true, inspections })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch vehicle inspections" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect()
    const body = await request.json()
    const { action, inspectionId, authorizerUserId, returnToServiceNotes, ...inspectionData } = body

    if (action === "authorize_return_to_service") {
      if (!inspectionId || !authorizerUserId) {
        return NextResponse.json(
          { success: false, error: "inspectionId and authorizerUserId are required for return to service authorization" },
          { status: 400 },
        )
      }
      const updatedInspection = await authorizeReturnToService(
        inspectionId,
        authorizerUserId,
        returnToServiceNotes,
      )
      return NextResponse.json({ success: true, inspection: updatedInspection })
    }

    const {
      vehicleId,
      inspectionType,
      inspectorUserId,
      inspectorName,
      overallResult,
      checklist = [],
      failureReason,
      odometerReading,
    } = inspectionData

    if (!vehicleId || !inspectionType || !overallResult) {
      return NextResponse.json(
        { success: false, error: "vehicleId, inspectionType, and overallResult are required" },
        { status: 400 },
      )
    }

    const hasCriticalFailure = checklist.some((item: any) => item.isCritical && !item.passed)

    const inspection = await VehicleInspection.create({
      vehicleId,
      inspectionType,
      inspectorUserId,
      inspectorName,
      overallResult,
      hasCriticalFailure: hasCriticalFailure || overallResult === "failed",
      checklist,
      failureReason,
      odometerReading,
    })

    // Re-evaluate vehicle compliance status
    await evaluateVehicleCompliance(vehicleId)

    return NextResponse.json({ success: true, inspection }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process inspection" },
      { status: 500 },
    )
  }
}
