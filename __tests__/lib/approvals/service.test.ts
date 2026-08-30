import { describe, it, expect, beforeAll, afterAll } from "vitest"
import mongoose from "mongoose"
import User from "@/models/User"
import ReconciliationDiscrepancy from "@/models/ReconciliationDiscrepancy"
import InvariantFinding from "@/models/InvariantFinding"
import ApprovalRequest from "@/models/ApprovalRequest"
import { runInvariantScan } from "@/lib/integrity/scanner"
import {
  createApprovalRequest,
  decideApprovalRequest,
  cancelApprovalRequest,
} from "@/lib/approvals/service"

describe("Maker-checker approval workflow (#104)", () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      try {
        await mongoose.connect(
          process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test",
          { serverSelectionTimeoutMS: 2000 },
        )
      } catch (err) {
        console.warn("MongoDB connection warning in test environment:", err)
      }
    }
  }, 10000)

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  })

  async function makeAdmin(suffix: string) {
    return User.create({
      fullName: `Admin ${suffix}`,
      email: `admin-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@chainmove.com`,
      role: "admin",
    })
  }

  async function makeDiscrepancy(ref: string) {
    return ReconciliationDiscrepancy.create({
      fingerprint: `FP-${ref}`,
      runId: "RECON-APPROVALS-TEST",
      category: "MISSING_INTERNAL_RECORD",
      providerReference: ref,
      providerAmount: 12345,
      providerCurrency: "NGN",
      providerStatus: "success",
      explanation: `Missing internal record for ${ref}`,
      remediationStatus: "unresolved",
    })
  }

  async function requestRemediation(requesterId: string, disc: { _id: unknown }) {
    return createApprovalRequest({
      operationType: "reconciliation.remediate",
      targetId: String(disc._id),
      rawCommand: { action: "RECONCILE_CREATE_TRANSACTION" },
      requester: { id: requesterId, role: "admin" },
      reason: "Verified against bank statement",
    })
  }

  it("rejects self-approval", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("self-req")
    const disc = await makeDiscrepancy(`SELF-${Date.now()}`)

    const { request, autoExecuted } = await requestRemediation(requester._id.toString(), disc)
    expect(autoExecuted).toBe(false)

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: requester._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "self_approval" })
  })

  it("blocks execution when the target changed after the request was created (stale resource version)", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("stale-req")
    const approver = await makeAdmin("stale-appr")
    const disc = await makeDiscrepancy(`STALE-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    // Touch the target without changing remediationStatus, bumping updatedAt
    // so the snapshot taken at request-creation no longer matches.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await ReconciliationDiscrepancy.updateOne({ _id: disc._id }, { $set: { explanation: "amended note" } })

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "stale_resource" })

    const reloaded = await ApprovalRequest.findById(request._id)
    expect(reloaded?.status).toBe("stale")
  })

  it("expires a request past its deadline instead of allowing a decision", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("expiry-req")
    const approver = await makeAdmin("expiry-appr")
    const disc = await makeDiscrepancy(`EXPIRE-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)
    await ApprovalRequest.updateOne({ _id: request._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "expired" })

    const reloaded = await ApprovalRequest.findById(request._id)
    expect(reloaded?.status).toBe("expired")
  })

  it("prevents duplicate approval/execution of an already-decided request", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("dup-req")
    const approver = await makeAdmin("dup-appr")
    const disc = await makeDiscrepancy(`DUP-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    const first = await decideApprovalRequest({
      requestId: request._id.toString(),
      decision: "approve",
      approver: { id: approver._id.toString(), role: "admin" },
    })
    expect(first.status).toBe("executed")

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "not_pending" })
  })

  it("rejects approval when the requester lost admin permission while the request was pending", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("lost-perm-req")
    const approver = await makeAdmin("lost-perm-appr")
    const disc = await makeDiscrepancy(`LOSTPERM-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)
    await User.updateOne({ _id: requester._id }, { $set: { role: "driver" } })

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "requester_permission_revoked" })

    const reloaded = await ApprovalRequest.findById(request._id)
    expect(reloaded?.status).toBe("rejected")
  })

  it("lets exactly one of two concurrent approvers win", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("concurrent-req")
    const approverA = await makeAdmin("concurrent-a")
    const approverB = await makeAdmin("concurrent-b")
    const disc = await makeDiscrepancy(`CONCURRENT-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    const results = await Promise.allSettled([
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approverA._id.toString(), role: "admin" },
      }),
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approverB._id.toString(), role: "admin" },
      }),
    ])

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1)
    expect(results.filter((r) => r.status === "rejected").length).toBe(1)

    const reloaded = await ApprovalRequest.findById(request._id)
    expect(reloaded?.status).toBe("executed")
  })

  it("does not allow a rejected request to later execute", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("rejected-req")
    const approver = await makeAdmin("rejected-appr")
    const disc = await makeDiscrepancy(`REJECT-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    const rejected = await decideApprovalRequest({
      requestId: request._id.toString(),
      decision: "reject",
      approver: { id: approver._id.toString(), role: "admin" },
      reason: "Not enough evidence",
    })
    expect(rejected.status).toBe("rejected")

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "not_pending" })
  })

  it("does not allow a cancelled request to later execute", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("cancel-req")
    const approver = await makeAdmin("cancel-appr")
    const disc = await makeDiscrepancy(`CANCEL-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    const cancelled = await cancelApprovalRequest({
      requestId: request._id.toString(),
      actor: { id: requester._id.toString(), role: "admin" },
    })
    expect(cancelled.status).toBe("cancelled")

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "not_pending" })
  })

  it("executes an approved request and links the resulting transaction/audit references", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("exec-req")
    const approver = await makeAdmin("exec-appr")
    const disc = await makeDiscrepancy(`EXEC-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    const executed = await decideApprovalRequest({
      requestId: request._id.toString(),
      decision: "approve",
      approver: { id: approver._id.toString(), role: "admin" },
    })

    expect(executed.status).toBe("executed")
    expect(executed.resultRefs.some((ref) => ref.type === "transaction")).toBe(true)
    expect(executed.resultRefs.some((ref) => ref.type === "audit_log")).toBe(true)

    const updatedDisc = await ReconciliationDiscrepancy.findById(disc._id)
    expect(updatedDisc?.remediationStatus).toBe("manually_resolved")
  })

  it("marks the request execution_failed (never silently executed) when the underlying operation fails", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("fail-req")
    const approver = await makeAdmin("fail-appr")
    const disc = await makeDiscrepancy(`FAIL-${Date.now()}`)

    const { request } = await requestRemediation(requester._id.toString(), disc)

    // Simulate the underlying record disappearing between request creation
    // and execution (e.g. a concurrent hard delete), so execution fails.
    await ReconciliationDiscrepancy.deleteOne({ _id: disc._id })

    await expect(
      decideApprovalRequest({
        requestId: request._id.toString(),
        decision: "approve",
        approver: { id: approver._id.toString(), role: "admin" },
      }),
    ).rejects.toMatchObject({ code: "target_not_found" })

    const reloaded = await ApprovalRequest.findById(request._id)
    expect(reloaded?.status).toBe("execution_failed")
    expect(reloaded?.executionError).toBeTruthy()
  })

  it("auto-executes a low-risk exempt action while still recording an audit trail", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("exempt-req")
    const disc = await makeDiscrepancy(`IGNORE-${Date.now()}`)

    const { request, autoExecuted } = await createApprovalRequest({
      operationType: "reconciliation.remediate",
      targetId: disc._id.toString(),
      rawCommand: { action: "IGNORE" },
      requester: { id: requester._id.toString(), role: "admin" },
      reason: "False positive, already reconciled manually",
    })

    expect(autoExecuted).toBe(true)
    expect(request.status).toBe("executed")

    const updatedDisc = await ReconciliationDiscrepancy.findById(disc._id)
    expect(updatedDisc?.remediationStatus).toBe("ignored")
  })

  it("blocks a second in-flight request for the same target", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requesterA = await makeAdmin("inflight-a")
    const requesterB = await makeAdmin("inflight-b")
    const disc = await makeDiscrepancy(`INFLIGHT-${Date.now()}`)

    await requestRemediation(requesterA._id.toString(), disc)

    await expect(requestRemediation(requesterB._id.toString(), disc)).rejects.toMatchObject({
      code: "already_in_flight",
    })
  })

  it("requires a privilege-crossing role change to go through approval, but not a lateral one", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("role-req")
    const approver = await makeAdmin("role-appr")
    const target = await User.create({
      fullName: "Role Target",
      email: `role-target-${Date.now()}@chainmove.com`,
      role: "driver",
    })

    const lateral = await createApprovalRequest({
      operationType: "user.role_reassign",
      targetId: target._id.toString(),
      rawCommand: { role: "investor" },
      requester: { id: requester._id.toString(), role: "admin" },
      reason: "Converting to an investor account",
    })
    expect(lateral.autoExecuted).toBe(true)

    const crossing = await createApprovalRequest({
      operationType: "user.role_reassign",
      targetId: target._id.toString(),
      rawCommand: { role: "admin" },
      requester: { id: requester._id.toString(), role: "admin" },
      reason: "Promoting to admin for the finance rollout",
    })
    expect(crossing.autoExecuted).toBe(false)

    const executed = await decideApprovalRequest({
      requestId: crossing.request._id.toString(),
      decision: "approve",
      approver: { id: approver._id.toString(), role: "admin" },
    })
    expect(executed.status).toBe("executed")

    const reloadedTarget = await User.findById(target._id)
    expect(reloadedTarget?.role).toBe("admin")
  })

  it("auto-executes a structural (non-financial) integrity repair through the approval engine", async () => {
    if (mongoose.connection.readyState !== 1) return
    const requester = await makeAdmin("repair-req")
    const legacyUser = await User.create({
      name: "Legacy Approval User",
      email: `legacy-approval-${Date.now()}@chainmove.com`,
      role: "driver",
      isKycVerified: true,
      kycVerified: false,
    })

    await runInvariantScan({ ruleIds: ["INV_LEGACY_FIELDS_MISMATCH"] })
    const finding = await InvariantFinding.findOne({
      ruleId: "INV_LEGACY_FIELDS_MISMATCH",
      primaryId: legacyUser._id.toString(),
    })
    expect(finding).toBeDefined()

    const { request, autoExecuted } = await createApprovalRequest({
      operationType: "integrity.repair.apply",
      targetId: finding!._id.toString(),
      rawCommand: {},
      requester: { id: requester._id.toString(), role: "admin" },
      reason: "Structural repair, no financial impact",
    })

    expect(autoExecuted).toBe(true)
    expect(request.status).toBe("executed")

    const reloadedFinding = await InvariantFinding.findById(finding!._id)
    expect(reloadedFinding?.status).toBe("REPAIRED")
  })
})
