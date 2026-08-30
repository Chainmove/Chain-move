import { NextResponse } from "next/server"
import { suppressFinding } from "@/lib/integrity/repairEngine"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { reason = "Manual false positive suppression", suppressedBy = "admin_api" } = body

    if (!id) {
      return NextResponse.json({ success: false, error: "Finding ID is required" }, { status: 400 })
    }

    const finding = await suppressFinding(id, reason, suppressedBy)
    return NextResponse.json({ success: true, finding })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to suppress finding" },
      { status: 500 },
    )
  }
}
