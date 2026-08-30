// @vitest-environment node
//
// Real ed25519 keypair generation (via @noble/curves) needs a working
// crypto.getRandomValues, which jsdom's default test environment does not
// provide reliably. This module has no DOM dependency, so it runs under the
// plain Node environment instead of the project-wide jsdom default.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk"
import * as stellarConfig from "@/lib/stellar/config"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/CustodySignerSet")
vi.mock("@/models/CustodyApprovalRequest")
vi.mock("@/models/CustodySequenceWatermark")
vi.mock("@/lib/security/audit-log", () => ({ logAuditEvent: vi.fn() }))
vi.mock("@/lib/stellar/config")

import {
  requestApproval,
  approve,
  finalizeAndSubmit,
  reconcileSubmission,
  expireStaleRequests,
  CustodyServiceError,
  AmbiguousSubmissionError,
} from "@/lib/custody/service"
import CustodySignerSet from "@/models/CustodySignerSet"
import CustodyApprovalRequest from "@/models/CustodyApprovalRequest"
import CustodySequenceWatermark from "@/models/CustodySequenceWatermark"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildEnvelope, computeEnvelopeHash } from "@/lib/custody/envelope"
import { computeOperationsHash } from "@/lib/custody/operations"
import type { SignerAdapter } from "@/lib/custody/types"

const TESTNET_CONFIG = {
  network: "testnet" as const,
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  assetCode: "CMOVE",
  issuerPublicKey: "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
  distributionPublicKey: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
  contractId: "",
  mock: true,
}

const SOURCE_ACCOUNT = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const DESTINATION = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"

function lean(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) } as any
}

function payoutIntent(amount = "10.0000000") {
  return {
    category: "payout" as const,
    operation: "distribution.payment",
    params: { destination: DESTINATION, assetCode: "native", amount },
  }
}

const PAYOUT_SIGNER_SET = {
  version: 2,
  payoutPolicy: { allowedDestinations: [DESTINATION], maxAmount: "1000000000", dailyLimit: "5000000000" },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(stellarConfig.getStellarConfig).mockReturnValue(TESTNET_CONFIG)
})

describe("requestApproval", () => {
  it("creates a pending request against the active signer set and records an audit event", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(PAYOUT_SIGNER_SET))
    vi.mocked(CustodyApprovalRequest.find).mockReturnValue(lean([]))
    vi.mocked(CustodyApprovalRequest.create).mockResolvedValue({
      _id: "req-1",
      toObject: () => ({ _id: "req-1", status: "pending" }),
    } as any)

    const result = await requestApproval({
      sourceAccount: SOURCE_ACCOUNT,
      sequence: "100",
      minTime: new Date(Date.now() - 1000),
      maxTime: new Date(Date.now() + 60_000),
      intent: payoutIntent(),
      requestedBy: "ops-1",
    })

    expect(result.status).toBe("pending")
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.approval.requested", criticalAction: true }))
  })

  it("rejects when there is no active signer set for the category", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(null))

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent(),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/No active signer set/)
  })

  it("rejects a stale/replayed sequence before ever creating a request", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean({ lastConsumedSequence: { toString: () => "100" } }))

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent(),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/Stale sequence rejected/)
    expect(CustodyApprovalRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a duplicate/replayed envelope surfaced as a DB unique-index conflict", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(PAYOUT_SIGNER_SET))
    vi.mocked(CustodyApprovalRequest.find).mockReturnValue(lean([]))
    const duplicateKeyError: any = new Error("duplicate key")
    duplicateKeyError.code = 11000
    vi.mocked(CustodyApprovalRequest.create).mockRejectedValue(duplicateKeyError)

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent(),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/Replay rejected/)
  })

  it("rejects a payout to a destination that is not on the signer set's allowlist", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(
      lean({ version: 2, payoutPolicy: { allowedDestinations: [SOURCE_ACCOUNT] } }),
    )
    vi.mocked(CustodyApprovalRequest.find).mockReturnValue(lean([]))

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent(),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/not on the payout allowlist/)
    expect(CustodyApprovalRequest.create).not.toHaveBeenCalled()
  })

  it("rejects a payout over the signer set's per-operation limit", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(
      lean({ version: 2, payoutPolicy: { allowedDestinations: [DESTINATION], maxAmount: "1000000" } }),
    )
    vi.mocked(CustodyApprovalRequest.find).mockReturnValue(lean([]))

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent("10.0000000"),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/exceeds per-operation limit/)
  })

  it("rejects a payout category request when the active signer set has no payoutPolicy configured", async () => {
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean({ version: 2 }))

    await expect(
      requestApproval({
        sourceAccount: SOURCE_ACCOUNT,
        sequence: "100",
        minTime: new Date(Date.now() - 1000),
        maxTime: new Date(Date.now() + 60_000),
        intent: payoutIntent(),
        requestedBy: "ops-1",
      }),
    ).rejects.toThrow(/no payoutPolicy/)
  })
})

describe("approve - threshold matrix and signer outage", () => {
  const signerSet = {
    threshold: 2,
    signers: [
      { signerId: "dist-1", role: "distribution", publicKey: SOURCE_ACCOUNT, weight: 1 },
      { signerId: "dist-2", role: "distribution", publicKey: DESTINATION, weight: 1 },
      { signerId: "dist-3", role: "distribution", publicKey: SOURCE_ACCOUNT, weight: 1 },
    ],
  }

  it("reaches quorum with only 2 of 3 eligible signers responding (tolerates one signer outage)", async () => {
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(signerSet))

    vi.mocked(CustodyApprovalRequest.findById).mockReturnValueOnce(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [] }),
    )
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockReturnValueOnce(
      lean({ status: "pending", approvals: [{ signerId: "dist-1" }] }),
    )
    const first = await approve({ requestId: "req-1", signerId: "dist-1", role: "distribution" as any })
    expect(first.status).toBe("pending")

    vi.mocked(CustodyApprovalRequest.findById).mockReturnValueOnce(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [{ signerId: "dist-1" }] }),
    )
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate)
      .mockReturnValueOnce(lean({ status: "pending", approvals: [{ signerId: "dist-1" }, { signerId: "dist-2" }] }))
      .mockReturnValueOnce(lean({ status: "quorum_reached", approvals: [{ signerId: "dist-1" }, { signerId: "dist-2" }] }))

    const second = await approve({ requestId: "req-1", signerId: "dist-2", role: "distribution" as any })
    expect(second.status).toBe("quorum_reached")
  })

  it("weights approvals rather than counting heads: a single higher-weight signer can satisfy the threshold alone", async () => {
    const weightedSignerSet = {
      threshold: 2,
      signers: [
        { signerId: "senior-1", role: "distribution", publicKey: SOURCE_ACCOUNT, weight: 2 },
        { signerId: "junior-1", role: "distribution", publicKey: DESTINATION, weight: 1 },
      ],
    }
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(weightedSignerSet))
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [] }),
    )
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate)
      .mockReturnValueOnce(lean({ status: "pending", approvals: [{ signerId: "senior-1" }] }))
      .mockReturnValueOnce(lean({ status: "quorum_reached", approvals: [{ signerId: "senior-1" }] }))

    const result = await approve({ requestId: "req-1", signerId: "senior-1", role: "distribution" as any })
    expect(result.status).toBe("quorum_reached")
  })

  it("does not reach quorum from two low-weight signers whose combined weight is still below threshold", async () => {
    const weightedSignerSet = {
      threshold: 3,
      signers: [
        { signerId: "junior-1", role: "distribution", publicKey: SOURCE_ACCOUNT, weight: 1 },
        { signerId: "junior-2", role: "distribution", publicKey: DESTINATION, weight: 1 },
      ],
    }
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(weightedSignerSet))
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [{ signerId: "junior-1" }] }),
    )
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockReturnValue(
      lean({ status: "pending", approvals: [{ signerId: "junior-1" }, { signerId: "junior-2" }] }),
    )

    const result = await approve({ requestId: "req-1", signerId: "junior-2", role: "distribution" as any })
    expect(result.status).toBe("pending")
  })

  it("rejects an ineligible signer/role", async () => {
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [] }),
    )
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(signerSet))

    await expect(approve({ requestId: "req-1", signerId: "unknown-signer", role: "distribution" as any })).rejects.toThrow(
      /not an eligible/,
    )
  })

  it("rejects the same signer approving twice (separation of duties)", async () => {
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "pending", maxTime: new Date(Date.now() + 60_000), approvals: [{ signerId: "dist-1" }] }),
    )
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean(signerSet))

    await expect(approve({ requestId: "req-1", signerId: "dist-1", role: "distribution" as any })).rejects.toThrow(
      /already approved/,
    )
  })

  it("rejects approving an expired request", async () => {
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "pending", maxTime: new Date(Date.now() - 1000), approvals: [] }),
    )

    await expect(approve({ requestId: "req-1", signerId: "dist-1", role: "distribution" as any })).rejects.toThrow(
      /expired/,
    )
  })
})

describe("finalizeAndSubmit", () => {
  function buildSigners() {
    const keypairA = Keypair.random()
    const keypairB = Keypair.random()
    return {
      keypairs: { "dist-1": keypairA, "dist-2": keypairB },
      descriptors: [
        { signerId: "dist-1", role: "distribution", publicKey: keypairA.publicKey(), weight: 1 },
        { signerId: "dist-2", role: "distribution", publicKey: keypairB.publicKey(), weight: 1 },
      ],
    }
  }

  function testAdapter(keypairs: Record<string, ReturnType<typeof Keypair.random>>): SignerAdapter {
    return {
      adapterId: "test",
      async getPublicKey(signerId: string) {
        return keypairs[signerId].publicKey()
      },
      async sign(signerId: string, payloadHash: string) {
        return keypairs[signerId].sign(Buffer.from(payloadHash, "hex")).toString("base64")
      },
    }
  }

  function claimedRequest(overrides: Partial<Record<string, unknown>> = {}) {
    const envelope = buildEnvelope({
      sourceAccount: SOURCE_ACCOUNT,
      sequence: "101",
      minTime: new Date(Date.now() - 1000),
      maxTime: new Date(Date.now() + 60_000),
      intent: payoutIntent(),
    })
    return {
      _id: "req-1",
      network: "testnet",
      category: "payout",
      operation: "distribution.payment",
      sourceAccount: SOURCE_ACCOUNT,
      sequence: "101",
      envelope,
      envelopeHash: computeEnvelopeHash(envelope),
      operationsHash: computeOperationsHash(envelope.intent),
      maxTime: envelope.maxTime,
      signerSetVersion: 1,
      approvals: [{ signerId: "dist-1" }, { signerId: "dist-2" }],
      ...overrides,
    }
  }

  it("builds, co-signs, and submits the transaction; advances the watermark; records the ledger result", async () => {
    const { keypairs, descriptors } = buildSigners()
    const request = claimedRequest()

    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockImplementation((query: any) => {
      if (query.status === "quorum_reached") return lean(request)
      return lean({ ...request, status: "submitted" })
    })
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean({ threshold: 2, signers: descriptors }))
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))

    const submit = vi.fn().mockResolvedValue({ hash: "ledgerhash123", ledger: 42, resultXdr: "AAAA" })

    const result = await finalizeAndSubmit("req-1", { adapter: testAdapter(keypairs), submit })

    expect(submit).toHaveBeenCalledTimes(1)
    const submittedXdr = submit.mock.calls[0][0] as string
    const parsedTx: any = TransactionBuilder.fromXDR(submittedXdr, request.envelope.networkPassphrase)
    expect(parsedTx.signatures).toHaveLength(2)

    expect(CustodySequenceWatermark.findOneAndUpdate).toHaveBeenCalled()
    expect(result?.status).toBe("submitted")
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.envelope.submitted" }))
  })

  it("refuses to finalize a request that is not quorum_reached (prevents double-submission)", async () => {
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockReturnValue(lean(null))

    await expect(finalizeAndSubmit("req-1", { submit: vi.fn() })).rejects.toThrow(CustodyServiceError)
  })

  it("rejects cross-intent tamper: recomputed operations hash no longer matches the approved hash", async () => {
    const { keypairs, descriptors } = buildSigners()
    const request = claimedRequest({ operationsHash: "0".repeat(64) })

    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockImplementation((query: any) => {
      if (query.status === "quorum_reached") return lean(request)
      return lean({ ...request, status: "failed" })
    })
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean({ threshold: 2, signers: descriptors }))
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))

    const submit = vi.fn()
    await expect(finalizeAndSubmit("req-1", { adapter: testAdapter(keypairs), submit })).rejects.toThrow(
      /Cross-intent replay rejected/,
    )
    expect(submit).not.toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.envelope.submission_failed" }))
  })

  it("leaves the request in submitting (not failed, not retried) when submission is ambiguous", async () => {
    const { keypairs, descriptors } = buildSigners()
    const request = claimedRequest()

    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockImplementation((query: any) => {
      if (query.status === "quorum_reached") return lean(request)
      throw new Error("must not attempt any further status transition for an ambiguous submission")
    })
    vi.mocked(CustodySignerSet.findOne).mockReturnValue(lean({ threshold: 2, signers: descriptors }))
    vi.mocked(CustodySequenceWatermark.findOne).mockReturnValue(lean(null))

    const submit = vi.fn().mockRejectedValue(new AmbiguousSubmissionError("Horizon timeout, outcome unknown"))

    await expect(finalizeAndSubmit("req-1", { adapter: testAdapter(keypairs), submit })).rejects.toThrow(AmbiguousSubmissionError)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "custody.envelope.submission_ambiguous" }))
  })
})

describe("reconcileSubmission", () => {
  it("only reconciles a request that is currently submitting", async () => {
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(lean({ status: "submitted" }))

    await expect(reconcileSubmission("req-1", { status: "submitted" })).rejects.toThrow(/Cannot reconcile/)
  })

  it("confirms a submission that actually landed and advances the watermark", async () => {
    vi.mocked(CustodyApprovalRequest.findById).mockReturnValue(
      lean({ status: "submitting", sourceAccount: SOURCE_ACCOUNT, network: "testnet", sequence: "101" }),
    )
    vi.mocked(CustodyApprovalRequest.findOneAndUpdate).mockReturnValue(lean({ status: "submitted" }))

    const result = await reconcileSubmission("req-1", {
      status: "submitted",
      ledgerResult: { hash: "abc", ledger: 1, resultXdr: "AAAA" },
    })

    expect(result.status).toBe("submitted")
    expect(CustodySequenceWatermark.findOneAndUpdate).toHaveBeenCalled()
  })
})

describe("expireStaleRequests", () => {
  it("only expires pending/quorum_reached requests past maxTime, never submitting ones", async () => {
    vi.mocked(CustodyApprovalRequest.updateMany).mockResolvedValue({ modifiedCount: 3 } as any)

    const result = await expireStaleRequests(new Date())
    expect(result.expiredCount).toBe(3)
    expect(CustodyApprovalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["pending", "quorum_reached"] } }),
      expect.objectContaining({ $set: { status: "expired" } }),
    )
  })
})
