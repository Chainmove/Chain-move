import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import VehicleDowntimePeriod from "@/models/VehicleDowntimePeriod"
import { endDowntimePeriod, startDowntimePeriod } from "@/lib/fleet/downtimeService"

export async function GET(request: Request) {
  try {
    await dbConnect()
    const { searchParams } = new URL(request.url)
    const vehicleId = searchParams.get("vehicleId")

    const filter = vehicleId ? { vehicleId } : {}
    const downtimePeriods = await VehicleDowntimePeriod.find(filter)
      .sort({ startTime: -1 })
      .lean()

    return NextResponse.json({ success: true, downtimePeriods })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch downtime periods" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect()
    const body = await request.json()
    const {
      action = "start",
      downtimeId,
      vehicleId,
      reason,
      startTime,
      endTime,
      driverUserId,
      contractId,
      maintenanceOrderId,
      incidentId,
      notes,
    } = body

    if (action === "end") {
      if (!downtimeId) {
        return NextResponse.json({ success: false, error: "downtimeId is required to end downtime" }, { status: 400 })
      }
      const period = await endDowntimePeriod(downtimeId, endTime ? new Date(endTime) : new Date())
      return NextResponse.json({ success: true, downtimePeriod: period })
    }

    if (!vehicleId || !reason) {
      return NextResponse.json({ success: false, error: "vehicleId and reason are required to start downtime" }, { status: 400 })
    }

    const period = await startDowntimePeriod(
      vehicleId,
      reason,
      startTime ? new Date(startTime) : new Date(),
      driverUserId,
      contractId,
      maintenanceOrderId,
      incidentId,
      notes,
    )

    return NextResponse.json({ success: true, downtimePeriod: period }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process downtime request" },
      { status: 500 },
    )
  }
}
