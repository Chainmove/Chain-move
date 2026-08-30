import mongoose from "mongoose"
import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import { getClientIpAddress } from "@/lib/security/rate-limit"
import Vehicle from "@/models/Vehicle"

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildVehicleUpdatePayload(body: unknown) {
  if (!isRecord(body)) {
    throw new Error("Invalid vehicle payload.")
  }

  const payload: Record<string, unknown> = {}

  if ("name" in body) payload.name = normalizeString(body.name)
  if ("identifier" in body) payload.identifier = normalizeString(body.identifier) || undefined
  if ("type" in body) payload.type = normalizeString(body.type)

  if ("year" in body) {
    const year = normalizeNumber(body.year)
    if (year === null) throw new Error("Invalid year.")
    payload.year = year
  }

  if ("price" in body) {
    const price = normalizeNumber(body.price)
    if (price === null) throw new Error("Invalid price.")
    payload.price = price
  }

  if ("roi" in body) {
    const roi = normalizeNumber(body.roi)
    if (roi === null) throw new Error("Invalid ROI.")
    payload.roi = roi
  }

  if ("features" in body) {
    if (!Array.isArray(body.features)) throw new Error("Invalid features list.")
    payload.features = body.features
      .map((feature) => normalizeString(feature))
      .filter(Boolean)
      .slice(0, 50)
  }

  if ("image" in body) payload.image = normalizeString(body.image) || undefined

  // status and fundingStatus are intentionally omitted — all status changes must
  // go through the /api/vehicles/[id]/transition endpoint.

  if ("totalFundedAmount" in body) {
    const totalFundedAmount = normalizeNumber(body.totalFundedAmount)
    if (totalFundedAmount === null) throw new Error("Invalid funded amount.")
    payload.totalFundedAmount = totalFundedAmount
  }

  if ("popularity" in body) {
    const popularity = normalizeNumber(body.popularity)
    if (popularity === null) throw new Error("Invalid popularity.")
    payload.popularity = popularity
  }

  if ("addedDate" in body) {
    const addedDate = normalizeString(body.addedDate)
    if (!addedDate) {
      payload.addedDate = undefined
    } else {
      const parsedDate = new Date(addedDate)
      if (Number.isNaN(parsedDate.getTime())) throw new Error("Invalid added date.")
      payload.addedDate = parsedDate
    }
  }

  if ("driverId" in body) {
    const driverId = normalizeString(body.driverId)
    if (driverId) {
      if (!isObjectId(driverId)) throw new Error("Invalid driverId.")
      payload.driverId = driverId
    } else {
      payload.$unset = { driverId: 1 }
    }
  }

  if ("specifications" in body) {
    if (!isRecord(body.specifications)) {
      throw new Error("Invalid specifications payload.")
    }

    const specifications: Record<string, string> = {}
    for (const key of ["engine", "fuelType", "mileage", "transmission", "color", "vin"] as const) {
      if (key in body.specifications) {
        const value = normalizeString(body.specifications[key])
        if (value) {
          specifications[key] = value
        }
      }
    }
    payload.specifications = specifications
  }

  return payload
}

async function requireAdmin(request: Request) {
  const authContext = await getAuthenticatedUser(request)
  if (!authContext.user) {
    return { response: NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 }) }
  }

  if (authContext.user.role !== "admin") {
    return { response: NextResponse.json({ success: false, message: "Admin access required" }, { status: 403 }) }
  }

  return authContext
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect()

  try {
    const authContext = await requireAdmin(request)
    if ("response" in authContext) return authContext.response

    const { id } = await params
    if (!isObjectId(id)) {
      return NextResponse.json({ success: false, message: "Invalid vehicle id" }, { status: 400 })
    }

    const vehicle = await Vehicle.findById(id)
    if (!vehicle) {
      return NextResponse.json({ success: false, message: "Vehicle not found" }, { status: 404 })
    }

    const response = NextResponse.json({ success: true, data: vehicle })
    return authContext.shouldRefreshSession ? withSessionRefresh(response, authContext.user) : response
  } catch (error) {
    console.error("VEHICLE_GET_ERROR", error)
    return NextResponse.json({ success: false, message: "Server Error" }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect()

  try {
    const authContext = await requireAdmin(request)
    if ("response" in authContext) return authContext.response

    const { id } = await params
    if (!isObjectId(id)) {
      return NextResponse.json({ success: false, message: "Invalid vehicle id" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const payload = buildVehicleUpdatePayload(body)
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, message: "No valid vehicle fields provided" }, { status: 400 })
    }

    const updatedVehicle = await Vehicle.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    })

    if (!updatedVehicle) {
      return NextResponse.json({ success: false, message: "Vehicle not found" }, { status: 404 })
    }

    await logAuditEvent({
      actor: authContext.user,
      action: "vehicle.update",
      targetType: "vehicle",
      targetId: id,
      ipAddress: getClientIpAddress(request),
      metadata: {
        fields: Object.keys(payload).filter((key) => key !== "$unset"),
      },
    })

    const response = NextResponse.json({ success: true, data: updatedVehicle })
    return authContext.shouldRefreshSession ? withSessionRefresh(response, authContext.user) : response
  } catch (error) {
    if (error instanceof Error && (error.name === "ValidationError" || /Invalid/.test(error.message))) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }

    console.error("VEHICLE_PUT_ERROR", error)
    return NextResponse.json({ success: false, message: "Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect()

  try {
    const authContext = await requireAdmin(request)
    if ("response" in authContext) return authContext.response

    const { id } = await params
    if (!isObjectId(id)) {
      return NextResponse.json({ success: false, message: "Invalid vehicle id" }, { status: 400 })
    }

    const deletedVehicle = await Vehicle.findByIdAndDelete(id)
    if (!deletedVehicle) {
      return NextResponse.json({ success: false, message: "Vehicle not found" }, { status: 404 })
    }

    await logAuditEvent({
      actor: authContext.user,
      action: "vehicle.delete",
      targetType: "vehicle",
      targetId: id,
      ipAddress: getClientIpAddress(request),
      metadata: {
        name: deletedVehicle.name,
      },
    })

    const response = NextResponse.json({ success: true, message: "Vehicle deleted successfully" })
    return authContext.shouldRefreshSession ? withSessionRefresh(response, authContext.user) : response
  } catch (error) {
    console.error("VEHICLE_DELETE_ERROR", error)
    return NextResponse.json({ success: false, message: "Server Error" }, { status: 500 })
  }
}
