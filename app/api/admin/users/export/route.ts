import { NextResponse } from "next/server"

import dbConnect from "@/lib/dbConnect"
import { withSessionRefresh } from "@/lib/auth/current-user"
import { authorizeRequest } from "@/lib/authorization/route"
import { csvEscape } from "@/lib/exports/csv-stream"
import User from "@/models/User"

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, "admin:report", { type: "report" })
    if ("response" in auth) return auth.response
    const { user, shouldRefreshSession } = auth

    await dbConnect()

    const users = await User.find({})
      .select("name fullName email role privyUserId createdAt")
      .sort({ createdAt: -1 })
      .lean()

    const headers = ["Name", "Email", "Role", "Privy User ID", "Created At"]
    const lines = [headers.map(csvEscape).join(",")]

    for (const entry of users) {
      lines.push(
        [
          entry.fullName || entry.name || "",
          entry.email || "",
          entry.role || "",
          entry.privyUserId || "",
          entry.createdAt ? new Date(entry.createdAt).toISOString() : "",
        ]
          .map(csvEscape)
          .join(","),
      )
    }

    const response = new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"users.csv\"",
      },
    })

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_USERS_EXPORT_ERROR", error)
    return NextResponse.json({ message: "Failed to export users." }, { status: 500 })
  }
}

