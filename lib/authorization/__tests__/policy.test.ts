import { describe, expect, it } from "vitest"
import { denialAuditMetadata } from "../redaction"
import { authorize, type AuthorizationAction } from "../policy"

const context = (role: "admin" | "driver" | "investor" | null, id = "user-a", options: { kycApproved?: boolean; privileged?: boolean } = {}) => ({ principal: { id, role, ...options } })

describe("central authorization policy", () => {
  const matrix: Array<[AuthorizationAction, "admin" | "driver" | "investor", boolean]> = [
    ["admin:report", "admin", true], ["admin:report", "driver", false], ["admin:report", "investor", false],
    ["kyc:review", "admin", true], ["kyc:review", "driver", false], ["kyc:review", "investor", false],
    ["investment:read", "admin", true], ["investment:read", "investor", true], ["investment:read", "driver", false],
    ["contract:read", "admin", true], ["contract:read", "driver", true], ["contract:read", "investor", false],
  ]
  it.each(matrix)("evaluates %s for %s", (action, role, allowed) => {
    const ownerId = role === "investor" || role === "driver" ? "user-a" : "user-b"
    const type = action.startsWith("investment") ? "investment" : action.startsWith("contract") ? "contract" : "report"
    expect(authorize(context(role), action, { type, ownerId }).allowed).toBe(allowed)
  })
  it("blocks cross-investor access without revealing existence", () => expect(authorize(context("investor"), "investment:read", { type: "investment", ownerId: "user-b" })).toEqual({ allowed: false, reason: "not_owner", conceal: true }))
  it("blocks cross-driver contract and repayment access", () => {
    expect(authorize(context("driver"), "contract:read", { type: "contract", ownerId: "user-b" }).allowed).toBe(false)
    expect(authorize(context("driver"), "repayment:read", { type: "repayment", ownerId: "user-b" }).allowed).toBe(false)
  })
  it("conceals stale or deleted resources", () => expect(authorize(context("admin"), "loan:read", { type: "loan", exists: false })).toEqual({ allowed: false, reason: "resource_unavailable", conceal: true }))
  it("rejects missing or malformed roles", () => expect(authorize(context(null), "wallet:read", { type: "wallet", ownerId: "user-a" }).allowed).toBe(false))
  it("requires KYC for new investments and loans", () => {
    expect(authorize(context("investor"), "investment:create", { type: "investment" }).allowed).toBe(false)
    expect(authorize(context("driver", "user-a", { kycApproved: true }), "loan:create", { type: "loan" }).allowed).toBe(true)
  })
  it("enforces admin workflow states", () => {
    expect(authorize(context("admin", "admin", { privileged: true }), "loan:approve", { type: "loan", state: "Completed" }).allowed).toBe(false)
    expect(authorize(context("admin", "admin", { privileged: true }), "loan:approve", { type: "loan", state: "Pending" }).allowed).toBe(true)
  })
  it("requires privileged context for wallet adjustment", () => expect(authorize(context("admin"), "wallet:adjust", { type: "wallet" }).allowed).toBe(false))
  it("redacts PII and identifiers from denial metadata", () => {
    const metadata = denialAuditMetadata("kyc:document:read", "kyc", { allowed: false, reason: "not_owner", conceal: true })
    expect(metadata).toEqual({ requestedAction: "kyc:document:read", resourceType: "kyc", reason: "not_owner" })
    expect(JSON.stringify(metadata)).not.toMatch(/email|documentRef|user-a/i)
  })
})
