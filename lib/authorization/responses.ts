import { NextResponse } from "next/server"
import type { AuthorizationDecision } from "./policy"

export function authorizationDeniedResponse(decision: Extract<AuthorizationDecision, { allowed: false }>) {
  if (decision.conceal) return NextResponse.json({ message: "Resource not found." }, { status: 404 })
  return NextResponse.json({ message: "Access denied." }, { status: 403 })
}

export const authenticationRequiredResponse = () => NextResponse.json({ message: "Unauthorized." }, { status: 401 })
