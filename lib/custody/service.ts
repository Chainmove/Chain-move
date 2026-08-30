import { Account, BASE_FEE, Keypair, Memo, TransactionBuilder, xdr } from "@stellar/stellar-sdk"
import mongoose from "mongoose"
import dbConnect from "@/lib/dbConnect"
import CustodySignerSet from "@/models/CustodySignerSet"
import CustodyApprovalRequest from "@/models/CustodyApprovalRequest"
import CustodySequenceWatermark from "@/models/CustodySequenceWatermark"
import { logAuditEvent } from "@/lib/security/audit-log"
import { getHorizonServer } from "@/lib/stellar/client"
import { buildEnvelope, computeEnvelopeHash, assertEnvelopeFresh } from "./envelope"
import { buildOperations, computeOperationsHash } from "./operations"
import { createSignerAdapter } from "./signer-adapter"
import { assertPayoutWithinPolicy, sumApprovedWeight } from "./policy"
import type { CustodyEnvelope, EnvelopeIntent, EnvelopeMemo, SignerAdapter, SignerRole } from "./types"
import type { PaymentParams } from "./operations"

export class CustodyServiceError extends Error {}
export class AmbiguousSubmissionError extends CustodyServiceError {}

async function getWatermark(sourceAccount: string, network: string): Promise<string | undefined> {
  const doc = (await CustodySequenceWatermark.findOne({ sourceAccount, network }).lean()) as any
  return doc ? doc.lastConsumedSequence.toString() : undefined
}

async function advanceWatermark(sourceAccount: string, network: string, sequence: string): Promise<void> {
  await CustodySequenceWatermark.findOneAndUpdate(
    { sourceAccount, network },
    { $max: { lastConsumedSequence: mongoose.Types.Decimal128.fromString(sequence) } },
    { upsert: true },
  )
}

const STROOPS_PER_UNIT = BigInt(10_000_000)

// Converts a decimal Stellar amount string (7 fractional digits, e.g.
// "10.5000000") to an integer stroop string, so payout limits can be
// compared exactly with BigInt instead of floating point.
function toStroops(decimalAmount: string): string {
  const [whole, fraction = ""] = decimalAmount.split(".")
  const paddedFraction = (fraction + "0".repeat(7)).slice(0, 7)
  const stroops = BigInt(whole || "0") * STROOPS_PER_UNIT + BigInt(paddedFraction || "0")
  return stroops.toString()
}

// Sums today's (UTC) not-yet-failed/expired payout requests for a source
// account, in stroops, so assertPayoutWithinPolicy can enforce a daily
// limit. Only pending/quorum_reached/submitting/submitted requests count -
// failed and expired requests never moved funds.
async function sumPendingOrSubmittedPayoutStroopsToday(sourceAccount: string, network: string): Promise<string> {
  const startOfDayUtc = new Date()
  startOfDayUtc.setUTCHours(0, 0, 0, 0)

  const requests = (await CustodyApprovalRequest.find({
    sourceAccount,
    network,
    category: "payout",
    status: { $in: ["pending", "quorum_reached", "submitting", "submitted"] },
    createdAt: { $gte: startOfDayUtc },
  }).lean()) as any[]

  let total = BigInt(0)
  for (const request of requests) {
    const params = request.envelope?.intent?.params as PaymentParams | undefined
    if (params?.amount) {
      total += BigInt(toStroops(params.amount))
    }
  }
  return total.toString()
}

export interface RequestApprovalInput {
  sourceAccount: string
  sequence: string
  minTime: Date
  maxTime: Date
  memo?: EnvelopeMemo
  intent: EnvelopeIntent
  requestedBy: string
  requestId?: string
  env?: NodeJS.ProcessEnv
}

// Creates a pending approval request for one custody operation. Validates
// the envelope (network, time bounds, stale-sequence) before persisting so
// a doomed request can never collect approvals. The unique DB indexes on
// (network, envelopeHash) and (sourceAccount, network, sequence) are the
// authoritative replay/duplicate guard under concurrent callers.
export async function requestApproval(input: RequestApprovalInput) {
  await dbConnect()

  const envelope = buildEnvelope({
    sourceAccount: input.sourceAccount,
    sequence: input.sequence,
    minTime: input.minTime,
    maxTime: input.maxTime,
    memo: input.memo,
    intent: input.intent,
    env: input.env,
  })

  const lastConsumedSequence = await getWatermark(envelope.sourceAccount, envelope.network)
  assertEnvelopeFresh({ envelope, lastConsumedSequence, env: input.env })

  const signerSet = (await CustodySignerSet.findOne({
    category: input.intent.category,
    network: envelope.network,
    status: "active",
  }).lean()) as any
  if (!signerSet) {
    throw new CustodyServiceError(`No active signer set for category "${input.intent.category}" on ${envelope.network}`)
  }

  if (input.intent.category === "payout") {
    if (!signerSet.payoutPolicy) {
      throw new CustodyServiceError("Payout signer set has no payoutPolicy (allowlist/limits) configured")
    }
    const paymentParams = input.intent.params as unknown as PaymentParams
    const dailyTotalSoFar = await sumPendingOrSubmittedPayoutStroopsToday(envelope.sourceAccount, envelope.network)
    assertPayoutWithinPolicy({
      amount: toStroops(paymentParams.amount),
      destination: paymentParams.destination,
      allowedDestinations: signerSet.payoutPolicy.allowedDestinations,
      maxAmount: signerSet.payoutPolicy.maxAmount,
      dailyLimit: signerSet.payoutPolicy.dailyLimit,
      dailyTotalSoFar,
    })
  }

  const envelopeHash = computeEnvelopeHash(envelope)
  const operationsHash = computeOperationsHash(input.intent)

  try {
    const request = await CustodyApprovalRequest.create({
      network: envelope.network,
      category: input.intent.category,
      operation: input.intent.operation,
      sourceAccount: envelope.sourceAccount,
      sequence: envelope.sequence,
      envelope,
      envelopeHash,
      operationsHash,
      minTime: envelope.minTime,
      maxTime: envelope.maxTime,
      signerSetVersion: signerSet.version,
      status: "pending",
      approvals: [],
      requestedBy: input.requestedBy,
      requestId: input.requestId,
    })

    await logAuditEvent({
      action: "custody.approval.requested",
      targetType: "custody_approval_request",
      targetId: request._id.toString(),
      requestId: input.requestId,
      metadata: {
        category: input.intent.category,
        operation: input.intent.operation,
        envelopeHash,
        sourceAccount: envelope.sourceAccount,
        sequence: envelope.sequence,
      },
      criticalAction: true,
    })

    return request.toObject()
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new CustodyServiceError("Replay rejected: an approval request for this envelope or sequence already exists")
    }
    throw error
  }
}

export interface ApproveInput {
  requestId: string
  signerId: string
  role: SignerRole
}

// Records one signer's approval. Enforces signer eligibility (role must
// match the pinned signer-set version), separation of duties (a signer can
// never approve the same request twice), and the approval-window bound.
// Quorum is evaluated against the signer set pinned to this request at
// creation time - old and new signer sets are never combined for one
// request, even during a rotation overlap window.
export async function approve(input: ApproveInput) {
  await dbConnect()
  const request = (await CustodyApprovalRequest.findById(input.requestId).lean()) as any
  if (!request) throw new CustodyServiceError("Approval request not found")
  if (request.status !== "pending" && request.status !== "quorum_reached") {
    throw new CustodyServiceError(`Cannot approve a request in status "${request.status}"`)
  }
  if (new Date() > new Date(request.maxTime)) {
    throw new CustodyServiceError("Approval window has expired; replay rejected")
  }

  const signerSet = (await CustodySignerSet.findOne({
    category: request.category,
    network: request.network,
    version: request.signerSetVersion,
    status: { $in: ["active", "retiring"] },
  }).lean()) as any
  if (!signerSet) {
    throw new CustodyServiceError("No active or retiring signer set backs this approval request")
  }

  const eligible = signerSet.signers.find((signer: any) => signer.signerId === input.signerId && signer.role === input.role)
  if (!eligible) {
    throw new CustodyServiceError(`"${input.signerId}" is not an eligible ${input.role} signer for this request`)
  }
  if ((request.approvals || []).some((approval: any) => approval.signerId === input.signerId)) {
    throw new CustodyServiceError(`"${input.signerId}" has already approved this request`)
  }

  const updated = (await CustodyApprovalRequest.findOneAndUpdate(
    { _id: input.requestId, status: request.status },
    { $push: { approvals: { signerId: input.signerId, role: input.role, approvedAt: new Date() } } },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!updated) throw new CustodyServiceError("Approval conflict; reload and retry")

  await logAuditEvent({
    action: "custody.approval.granted",
    targetType: "custody_approval_request",
    targetId: input.requestId,
    metadata: { signerId: input.signerId, role: input.role },
    criticalAction: true,
  })

  const approvedWeight = sumApprovedWeight(updated.approvals, signerSet.signers)
  if (approvedWeight >= signerSet.threshold && updated.status === "pending") {
    const promoted = (await CustodyApprovalRequest.findOneAndUpdate(
      { _id: input.requestId, status: "pending" },
      { $set: { status: "quorum_reached" } },
      { new: true, runValidators: true },
    ).lean()) as any
    return promoted ?? updated
  }

  return updated
}

function attachSignature(tx: { addDecoratedSignature(signature: InstanceType<typeof xdr.DecoratedSignature>): void }, publicKey: string, signatureBase64: string) {
  const keypair = Keypair.fromPublicKey(publicKey)
  const hint = keypair.signatureHint()
  const signature = Buffer.from(signatureBase64, "base64")
  tx.addDecoratedSignature(new xdr.DecoratedSignature({ hint, signature }))
}

export interface FinalizeOptions {
  env?: NodeJS.ProcessEnv
  adapter?: SignerAdapter
  submit?: (envelopeXdr: string) => Promise<{ hash: string; ledger: number; resultXdr: string }>
  now?: Date
}

// Finalizes a quorum-reached request: recomputes envelope and operations
// hashes against live inputs, builds and co-signs the real transaction, and
// submits it. Claims the request via an atomic (quorum_reached ->
// submitting) status transition first, so two concurrent finalize calls
// (e.g. a caller retrying after a timeout) can never both submit. If
// submit() throws AmbiguousSubmissionError, the request is left in
// "submitting" for reconcileSubmission rather than retried automatically.
export async function finalizeAndSubmit(requestId: string, options: FinalizeOptions = {}) {
  await dbConnect()

  const claimed = (await CustodyApprovalRequest.findOneAndUpdate(
    { _id: requestId, status: "quorum_reached" },
    { $set: { status: "submitting" } },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!claimed) {
    throw new CustodyServiceError(
      "Cannot finalize: request is not in quorum_reached status (already submitting/submitted/failed/expired, or quorum not met)",
    )
  }

  const now = options.now ?? new Date()

  try {
    if (now.getTime() > new Date(claimed.maxTime).getTime()) {
      throw new CustodyServiceError("Approval window expired before submission; replay rejected")
    }

    const envelope = claimed.envelope as CustodyEnvelope
    if (computeEnvelopeHash(envelope) !== claimed.envelopeHash) {
      throw new CustodyServiceError("Envelope integrity check failed: stored envelope does not match its recorded hash")
    }

    const lastConsumedSequence = await getWatermark(claimed.sourceAccount, claimed.network)
    assertEnvelopeFresh({ envelope, now, lastConsumedSequence, env: options.env })

    const operationsHash = computeOperationsHash(envelope.intent)
    if (operationsHash !== claimed.operationsHash) {
      throw new CustodyServiceError("Cross-intent replay rejected: recomputed operations do not match what signers approved")
    }

    const signerSet = (await CustodySignerSet.findOne({
      category: claimed.category,
      network: claimed.network,
      version: claimed.signerSetVersion,
    }).lean()) as any
    if (!signerSet) throw new CustodyServiceError("Signer set no longer exists")

    const distinctApprovers = [...new Set((claimed.approvals || []).map((approval: any) => approval.signerId))] as string[]
    const approvedWeight = sumApprovedWeight(claimed.approvals || [], signerSet.signers)
    if (approvedWeight < signerSet.threshold) {
      throw new CustodyServiceError(`Quorum not met at finalize time: weight ${approvedWeight}/${signerSet.threshold}`)
    }

    const operations = buildOperations(envelope.intent)
    const account = new Account(envelope.sourceAccount, (BigInt(envelope.sequence) - BigInt(1)).toString())
    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: envelope.networkPassphrase,
      timebounds: {
        minTime: Math.floor(new Date(envelope.minTime).getTime() / 1000),
        maxTime: Math.floor(new Date(envelope.maxTime).getTime() / 1000),
      },
    })
    for (const operation of operations) builder.addOperation(operation)
    if (envelope.memo.type !== "none" && envelope.memo.value) {
      builder.addMemo(
        envelope.memo.type === "text"
          ? Memo.text(envelope.memo.value)
          : envelope.memo.type === "id"
            ? Memo.id(envelope.memo.value)
            : Memo.hash(envelope.memo.value),
      )
    }
    const tx = builder.build()
    const payloadHash = tx.hash().toString("hex")

    const adapter = options.adapter ?? createSignerAdapter(options.env)
    for (const signerId of distinctApprovers) {
      const signer = signerSet.signers.find((candidate: any) => candidate.signerId === signerId)
      if (!signer) continue
      const signature = await adapter.sign(signerId, payloadHash)
      attachSignature(tx, signer.publicKey, signature)
    }

    const submit =
      options.submit ??
      (async (xdrString: string) => {
        const horizon = getHorizonServer()
        const parsed = TransactionBuilder.fromXDR(xdrString, envelope.networkPassphrase)
        try {
          const result: any = await horizon.submitTransaction(parsed as any)
          return {
            hash: result.hash,
            ledger: result.ledger,
            resultXdr: result.result_xdr ?? result.resultXdr,
          }
        } catch (submitError: any) {
          // Horizon returned a well-formed rejection (bad sequence, malformed
          // transaction, insufficient signature weight, etc.) - the
          // submission definitely never landed, so it is safe to fail.
          // Anything without an HTTP response (timeout, connection reset,
          // DNS failure) means Horizon may or may not have applied the
          // transaction, and must not be treated as a definite failure.
          const hasDefiniteHorizonResponse = submitError?.response?.status !== undefined
          if (!hasDefiniteHorizonResponse) {
            throw new AmbiguousSubmissionError(submitError?.message || "Horizon submission outcome unknown")
          }
          throw submitError
        }
      })

    const ledgerResult = await submit(tx.toXDR())

    await advanceWatermark(claimed.sourceAccount, claimed.network, envelope.sequence)

    const submitted = (await CustodyApprovalRequest.findOneAndUpdate(
      { _id: requestId, status: "submitting" },
      { $set: { status: "submitted", ledgerResult: { ...ledgerResult, submittedAt: new Date() } } },
      { new: true, runValidators: true },
    ).lean()) as any

    await logAuditEvent({
      action: "custody.envelope.submitted",
      targetType: "custody_approval_request",
      targetId: requestId,
      metadata: {
        category: claimed.category,
        operation: claimed.operation,
        envelopeHash: claimed.envelopeHash,
        ledgerHash: ledgerResult.hash,
        ledger: ledgerResult.ledger,
      },
      criticalAction: true,
    })

    return submitted
  } catch (error: any) {
    if (error instanceof AmbiguousSubmissionError) {
      await logAuditEvent({
        action: "custody.envelope.submission_ambiguous",
        targetType: "custody_approval_request",
        targetId: requestId,
        status: "failure",
        metadata: { category: claimed.category, envelopeHash: claimed.envelopeHash, reason: error.message },
        criticalAction: true,
      })
      throw error
    }

    await CustodyApprovalRequest.findOneAndUpdate(
      { _id: requestId, status: "submitting" },
      { $set: { status: "failed", failureReason: error?.message || "Unknown submission failure" } },
      { new: true, runValidators: true },
    ).lean()

    await logAuditEvent({
      action: "custody.envelope.submission_failed",
      targetType: "custody_approval_request",
      targetId: requestId,
      status: "failure",
      metadata: { category: claimed.category, envelopeHash: claimed.envelopeHash, reason: error?.message },
      criticalAction: true,
    })

    throw error
  }
}

export interface ReconcileOutcome {
  status: "submitted" | "failed"
  ledgerResult?: { hash: string; ledger: number; resultXdr: string }
  reason?: string
}

// Manual operator path for requests stuck in "submitting" after an
// ambiguous or crashed submission (see docs/custody-signer-rotation.md,
// "Stuck sequence" and "Outage" runbooks). Takes an authoritative Horizon
// lookup result rather than retrying blindly, so a submission that already
// landed on the ledger can never be double-submitted.
export async function reconcileSubmission(requestId: string, outcome: ReconcileOutcome) {
  await dbConnect()
  const request = (await CustodyApprovalRequest.findById(requestId).lean()) as any
  if (!request) throw new CustodyServiceError("Approval request not found")
  if (request.status !== "submitting") {
    throw new CustodyServiceError(`Cannot reconcile a request in status "${request.status}"`)
  }

  const update =
    outcome.status === "submitted"
      ? { status: "submitted", ledgerResult: { ...outcome.ledgerResult, submittedAt: new Date() } }
      : { status: "failed", failureReason: outcome.reason || "Reconciled as failed" }

  const reconciled = (await CustodyApprovalRequest.findOneAndUpdate(
    { _id: requestId, status: "submitting" },
    { $set: update },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!reconciled) throw new CustodyServiceError("Reconciliation conflict; reload and retry")

  if (outcome.status === "submitted") {
    await advanceWatermark(request.sourceAccount, request.network, request.sequence)
  }

  await logAuditEvent({
    action: "custody.envelope.reconciled",
    targetType: "custody_approval_request",
    targetId: requestId,
    metadata: { outcomeStatus: outcome.status, reason: outcome.reason },
    criticalAction: true,
  })

  return reconciled
}

// Expires pending/quorum-reached requests once their approval window has
// elapsed, guaranteeing an expired envelope can never later be approved or
// submitted (replay-by-delay fails). "submitting" requests are deliberately
// excluded - they require reconcileSubmission, not blind expiry, since a
// submission may already have landed on the ledger.
export async function expireStaleRequests(now: Date = new Date()) {
  await dbConnect()
  const result = await CustodyApprovalRequest.updateMany(
    { status: { $in: ["pending", "quorum_reached"] }, maxTime: { $lt: now } },
    { $set: { status: "expired" } },
  )
  return { expiredCount: result.modifiedCount }
}
