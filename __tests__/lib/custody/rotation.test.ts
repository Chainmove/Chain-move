import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  proposeRotation,
  approveRotation,
  activateRotation,
  retireIfSafe,
  rollbackRotation,
  seedGenesisSignerSet,
  RotationError,
} from "@/lib/custody/rotation"
import CustodySignerSet from "@/models/CustodySignerSet"
import CustodyApprovalRequest from "@/models/CustodyApprovalRequest"
import { logAuditEvent } from "@/lib/security/audit-log"

vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/CustodySignerSet")
vi.mock("@/models/CustodyApprovalRequest")
vi.mock("@/lib/security/audit-log", () => ({ logAuditEvent: vi.fn() }))

const KEY_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const KEY_B = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const KEY_C = "GBRLHRADGGA2RPHJ3AVHOTIT3GENGHQETXTHOHY4IUJJLI26KHWQBD6U"

const ROTATION_SIGNERS = [
  { signerId: "issuer-1", role: "issuer" as const, publicKey: KEY_A, weight: 1 },
  { signerId: "distribution-1", role: "distribution" as const, publicKey: KEY_B, weight: 1 },
  { signerId: "security-1", role: "security" as const, publicKey: KEY_C, weight: 1 },
]

function lean(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) } as any
}

const GOVERNING_ROTATION_SET = {
  category: "rotation",
  threshold: 2,
  signers: [
    { signerId: "admin-1", role: "issuer", publicKey: KEY_A, weight: 1 },
    { signerId: "admin-2", role: "distribution", publicKey: KEY_B, weight: 1 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("proposeRotation", () => {
  it("creates a pending signer set versioned after the current active one", async () => {
    vi.mocked(CustodySignerSet.findOne).mockImplementation((query: any) => {
      if (query.status === "active") return { sort: vi.fn().mockReturnValue(lean({ version: 3 })) } as any
      return lean(null)
    })
    vi.mocked(CustodySignerSet.create).mockResolvedValue({
      _id: "set-1",
      toObject: () => ({ _id: "set-1", version: 4, status: "pending" }),
    } as any)

    const result = await proposeRotation({
      category: "rotation",
      network: "testnet",
      signers: ROTATION_SIGNERS,
      threshold: 2,
      createdBy: "admin-1",
    })

    expect(result.version).toBe(4)
    expect(CustodySignerSet.create).toHaveBeenCalledWith(expect.objectContaining({ version: 4, previousVersion: 3, status: "pending" }))
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.rotation.proposed", criticalAction: true }))
  })

  it("rejects a second pending rotation for the same category/network", async () => {
    vi.mocked(CustodySignerSet.findOne).mockImplementation((query: any) => {
      if (query.status === "active") return { sort: vi.fn().mockReturnValue(lean(null)) } as any
      return lean({ _id: "already-pending" })
    })

    await expect(
      proposeRotation({ category: "rotation", network: "testnet", signers: ROTATION_SIGNERS, threshold: 2, createdBy: "admin-1" }),
    ).rejects.toThrow(/already pending/)
  })

  it("rejects an invalid signer set before ever touching the database", async () => {
    await expect(
      proposeRotation({ category: "rotation", network: "testnet", signers: ROTATION_SIGNERS, threshold: 99, createdBy: "admin-1" }),
    ).rejects.toThrow()
    expect(CustodySignerSet.findOne).not.toHaveBeenCalled()
  })
})

describe("approveRotation", () => {
  it("accumulates distinct approvers and reports when quorum is met", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "pending", network: "testnet", rotationApprovals: [] }))
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockReturnValue(
      lean({ rotationApprovals: [{ approvedBy: "admin-1", quorumType: "standard" }] }),
    )

    const firstResult = await approveRotation({ signerSetId: "set-1", approvedBy: "admin-1", role: "issuer", quorumType: "standard" })
    expect(firstResult.quorumMet).toBe(false)

    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "pending", network: "testnet", rotationApprovals: [{ approvedBy: "admin-1", quorumType: "standard" }] }),
    )
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockReturnValue(
      lean({
        rotationApprovals: [
          { approvedBy: "admin-1", quorumType: "standard" },
          { approvedBy: "admin-2", quorumType: "standard" },
        ],
      }),
    )
    const secondResult = await approveRotation({ signerSetId: "set-1", approvedBy: "admin-2", role: "distribution", quorumType: "standard" })
    expect(secondResult.quorumMet).toBe(true)
  })

  it("rejects an approver who is not a real signer in the governing signer set (prevents fabricated-identity quorum)", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "pending", network: "testnet", rotationApprovals: [] }))

    await expect(
      approveRotation({ signerSetId: "set-1", approvedBy: "attacker-1", role: "issuer", quorumType: "standard" }),
    ).rejects.toThrow(/not an eligible/)
    expect(CustodySignerSet.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it("rejects a real signerId approving under the wrong role", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "pending", network: "testnet", rotationApprovals: [] }))

    await expect(
      approveRotation({ signerSetId: "set-1", approvedBy: "admin-1", role: "security", quorumType: "standard" }),
    ).rejects.toThrow(/not an eligible/)
  })

  it("rejects when no active governing signer set is configured for the network", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "pending", network: "testnet", rotationApprovals: [] }))

    await expect(
      approveRotation({ signerSetId: "set-1", approvedBy: "admin-1", role: "issuer", quorumType: "standard" }),
    ).rejects.toThrow(/No active rotation signer set/)
  })

  it("rejects the same approver approving twice (separation of duties)", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "pending", network: "testnet", rotationApprovals: [{ approvedBy: "admin-1", quorumType: "standard" }] }),
    )

    await expect(
      approveRotation({ signerSetId: "set-1", approvedBy: "admin-1", role: "issuer", quorumType: "standard" }),
    ).rejects.toThrow(/already approved/)
  })

  it("rejects approving a signer set that is not pending", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "active", network: "testnet", rotationApprovals: [] }))

    await expect(
      approveRotation({ signerSetId: "set-1", approvedBy: "admin-1", role: "issuer", quorumType: "standard" }),
    ).rejects.toThrow(RotationError)
  })
})

describe("activateRotation", () => {
  it("activates once quorum is met and puts the previous active set into an overlap-safe retiring window", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({
        status: "pending",
        category: "rotation",
        network: "testnet",
        version: 4,
        previousVersion: 3,
        overlapWindowMs: 1000,
        rotationApprovals: [
          { approvedBy: "admin-1", quorumType: "standard" },
          { approvedBy: "admin-2", quorumType: "standard" },
        ],
      }),
    )
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockImplementation((query: any) => {
      if (query.status === "pending") return lean({ status: "active", version: 4 })
      return lean({ status: "retiring", version: 3, effectiveTo: new Date(Date.now() + 1000) })
    })

    const result = await activateRotation("set-1")
    expect(result.active.status).toBe("active")
    expect(result.retiring.status).toBe("retiring")
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.rotation.activated" }))
  })

  it("refuses to activate when quorum has not been met", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "pending", network: "testnet", version: 4, rotationApprovals: [{ approvedBy: "admin-1", quorumType: "standard" }] }),
    )
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(GOVERNING_ROTATION_SET))

    await expect(activateRotation("set-1")).rejects.toThrow(/quorum not met/i)
  })
})

describe("retireIfSafe - rotation with pending approvals", () => {
  it("refuses to retire while approval requests still reference the retiring signer set version", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "retiring", version: 3, category: "rotation", network: "testnet", effectiveTo: new Date(Date.now() - 1000) }),
    )
    vi.mocked(CustodyApprovalRequest.countDocuments).mockResolvedValue(2 as any)

    const result = await retireIfSafe("set-1")
    expect(result.retired).toBe(false)
    expect(result.reason).toMatch(/pending/)
    expect(CustodySignerSet.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it("refuses to retire before the overlap window has elapsed", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "retiring", version: 3, category: "rotation", network: "testnet", effectiveTo: new Date(Date.now() + 60_000) }),
    )

    const result = await retireIfSafe("set-1")
    expect(result.retired).toBe(false)
    expect(result.reason).toMatch(/overlap/i)
  })

  it("retires once the overlap window has elapsed and no requests remain pending - this is the only path to retired", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "retiring", version: 3, category: "rotation", network: "testnet", effectiveTo: new Date(Date.now() - 1000) }),
    )
    vi.mocked(CustodyApprovalRequest.countDocuments).mockResolvedValue(0 as any)
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockReturnValue(lean({ status: "retired", version: 3 }))

    const result = await retireIfSafe("set-1")
    expect(result.retired).toBe(true)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.rotation.retired" }))
  })
})

describe("rollbackRotation", () => {
  it("reactivates the previous signer set when rolling back an active rotation", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "active", version: 4, category: "rotation", network: "testnet", previousVersion: 3 }),
    )
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockImplementation((query: any) => {
      if (query.status === "active") return lean({ status: "rolled_back", version: 4 })
      return lean({ status: "active", version: 3 })
    })

    const result = await rollbackRotation("set-4", { reason: "compromised signer detected" })
    expect(result.rolledBack.status).toBe("rolled_back")
    expect(result.reactivated.status).toBe("active")
  })

  it("rolls back a still-pending rotation without touching any previous set", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(lean({ status: "pending", version: 4, category: "rotation", network: "testnet" }))
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockReturnValue(lean({ status: "rolled_back", version: 4 }))

    const result = await rollbackRotation("set-4", { reason: "duplicate proposal" })
    expect(result.rolledBack.status).toBe("rolled_back")
    expect(result.reactivated).toBeNull()
  })

  it("aborts (does not flip the current set to rolled_back) when the previous set is already fully retired - never leaves zero active sets", async () => {
    vi.mocked(CustodySignerSet.findById).mockReturnValue(
      lean({ status: "active", version: 4, category: "rotation", network: "testnet", previousVersion: 3 }),
    )
    // Reactivation query finds nothing because the previous set is already "retired" (terminal), not "retiring".
    vi.mocked(CustodySignerSet.findOneAndUpdate).mockReturnValue(lean(null))

    await expect(rollbackRotation("set-4", { reason: "too late" })).rejects.toThrow(/already retired/)

    // The rolled_back flip must never have been attempted once reactivation failed -
    // findOneAndUpdate should only have been called once, for the reactivation attempt.
    expect(CustodySignerSet.findOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(CustodySignerSet.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retiring" }),
      expect.anything(),
      expect.anything(),
    )
  })
})

describe("seedGenesisSignerSet", () => {
  it("requires the exact confirmation token", async () => {
    await expect(
      seedGenesisSignerSet({
        category: "rotation",
        network: "testnet",
        signers: ROTATION_SIGNERS,
        threshold: 2,
        createdBy: "admin-1",
        confirmationToken: "wrong-token",
      }),
    ).rejects.toThrow(/confirmationToken/)
    expect(CustodySignerSet.findOne).not.toHaveBeenCalled()
  })

  it("refuses to seed if a signer set already exists for the category/network", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean({ _id: "existing-set" }))

    await expect(
      seedGenesisSignerSet({
        category: "rotation",
        network: "testnet",
        signers: ROTATION_SIGNERS,
        threshold: 2,
        createdBy: "admin-1",
        confirmationToken: "CONFIRM_GENESIS_SIGNER_SET",
      }),
    ).rejects.toThrow(/already exists/)
  })

  it("creates the first signer set directly as active for a brand new category/network", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.create).mockResolvedValue({
      _id: "genesis-set",
      toObject: () => ({ _id: "genesis-set", version: 1, status: "active" }),
    } as any)

    const result = await seedGenesisSignerSet({
      category: "rotation",
      network: "testnet",
      signers: ROTATION_SIGNERS,
      threshold: 2,
      createdBy: "admin-1",
      confirmationToken: "CONFIRM_GENESIS_SIGNER_SET",
    })

    expect(result.status).toBe("active")
    expect(CustodySignerSet.create).toHaveBeenCalledWith(expect.objectContaining({ version: 1, status: "active" }))
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.rotation.genesis_seeded" }))
  })
})
