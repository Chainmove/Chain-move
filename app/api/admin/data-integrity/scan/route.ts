import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import InvariantFinding from "@/models/InvariantFinding"
import { runInvariantScan } from "@/lib/integrity/scanner"
import { generateCsvExport, generateJsonSummary } from "@/lib/integrity/reporting"

export async function GET(request: Request) {
  try {
    await dbConnect()
    const { searchParams } = new URL(request.url)
    const format = searchParams.get("format") || "json"

    const findings = await InvariantFinding.find({}).sort({ updatedAt: -1 }).lean()

    if (format === "csv") {
      const csvData = generateCsvExport(findings as any)
      return new NextResponse(csvData, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="data-integrity-report.csv"',
        },
      })
    }

    const summary = generateJsonSummary(findings as any)
    return NextResponse.json({ success: true, summary })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch scan summary" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { ruleIds } = body

    const result = await runInvariantScan({ ruleIds })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to execute scan" },
      { status: 500 },
    )
  }
}
