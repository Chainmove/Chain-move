import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import VehicleMaintenanceOrder from "@/models/VehicleMaintenanceOrder"
import {
  adjustMaintenanceCost,
  transitionMaintenanceState,
} from "@/lib/fleet/maintenanceService"
import {
  projectMaintenanceForDriver,
  projectMaintenanceListForDriver,
} from "@/lib/fleet/projection"

export async function GET(request: Request) {
  try {
    await dbConnect()
    const { searchParams } = new URL(request.url)
    const vehicleId = searchParams.get("vehicleId")
    const role = searchParams.get("role") || "admin"

    const filter = vehicleId ? { vehicleId } : {}
    const orders = await VehicleMaintenanceOrder.find(filter).sort({ createdAt: -1 }).lean()

    const responseOrders = role === "driver" ? projectMaintenanceListForDriver(orders) : orders

    return NextResponse.json({ success: true, maintenanceOrders: responseOrders })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch maintenance orders" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect()
    const body = await request.json()

    const {
      vehicleId,
      driverUserId,
      reportedByUserId,
      issueTitle,
      description,
      category = "repair",
      vendorName,
      vendorContact,
      estimatedCostNgn = 0,
      driverNotes,
      internalNotes,
    } = body

    if (!vehicleId || !issueTitle || !description) {
      return NextResponse.json(
        { success: false, error: "vehicleId, issueTitle, and description are required" },
        { status: 400 },
      )
    }

    const workOrderNumber = `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`

    const order = await VehicleMaintenanceOrder.create({
      workOrderNumber,
      vehicleId,
      driverUserId,
      reportedByUserId,
      issueTitle,
      description,
      category,
      state: "reported",
      vendorName,
      vendorContact,
      estimatedCostNgn,
      driverNotes,
      internalNotes,
    })

    return NextResponse.json({ success: true, maintenanceOrder: order }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create maintenance order" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    await dbConnect()
    const body = await request.json()
    const { action, orderId, targetState, newEstimate, reason, actorUserId, notes } = body

    if (!orderId) {
      return NextResponse.json({ success: false, error: "orderId is required" }, { status: 400 })
    }

    if (action === "transition") {
      if (!targetState) {
        return NextResponse.json({ success: false, error: "targetState is required" }, { status: 400 })
      }
      const updatedOrder = await transitionMaintenanceState(orderId, targetState, actorUserId, notes)
      return NextResponse.json({ success: true, maintenanceOrder: updatedOrder })
    }

    if (action === "adjust_cost") {
      if (newEstimate === undefined || !reason || !actorUserId) {
        return NextResponse.json(
          { success: false, error: "newEstimate, reason, and actorUserId are required for cost adjustment" },
          { status: 400 },
        )
      }
      const updatedOrder = await adjustMaintenanceCost(orderId, newEstimate, reason, actorUserId)
      return NextResponse.json({ success: true, maintenanceOrder: updatedOrder })
    }

    return NextResponse.json({ success: false, error: "Invalid maintenance PATCH action" }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update maintenance order" },
      { status: 500 },
    )
  }
}
