import { Asset, Operation } from "@stellar/stellar-sdk"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import { canonicalHash } from "./canonical"
import type { EnvelopeIntent } from "./types"

export class OperationBuildError extends Error {}

export interface PaymentParams {
  destination: string
  assetCode: string
  assetIssuer?: string
  amount: string
}

export interface SetSignerOptionsParams {
  signer?: { publicKey: string; weight: number }
  masterWeight?: number
  lowThreshold?: number
  medThreshold?: number
  highThreshold?: number
}

function buildPayment(params: PaymentParams) {
  if (!params || typeof params.destination !== "string" || typeof params.amount !== "string") {
    throw new OperationBuildError("Payment requires destination and amount")
  }
  const destination = normalizeStellarPublicKey(params.destination)
  if (!isValidStellarPublicKey(destination)) {
    throw new OperationBuildError("Invalid payment destination")
  }

  const asset =
    params.assetCode === "native" || params.assetCode === "XLM"
      ? Asset.native()
      : new Asset(params.assetCode, normalizeStellarPublicKey(params.assetIssuer || ""))

  return [Operation.payment({ destination, asset, amount: params.amount })]
}

function buildSetSignerOptions(params: SetSignerOptionsParams) {
  if (!params || typeof params !== "object") {
    throw new OperationBuildError("setSignerOptions requires parameters")
  }
  const options: Record<string, unknown> = {}
  if (params.signer) {
    const publicKey = normalizeStellarPublicKey(params.signer.publicKey)
    if (!isValidStellarPublicKey(publicKey)) {
      throw new OperationBuildError("Invalid signer public key in setSignerOptions")
    }
    options.signer = { ed25519PublicKey: publicKey, weight: params.signer.weight }
  }
  if (params.masterWeight !== undefined) options.masterWeight = params.masterWeight
  if (params.lowThreshold !== undefined) options.lowThreshold = params.lowThreshold
  if (params.medThreshold !== undefined) options.medThreshold = params.medThreshold
  if (params.highThreshold !== undefined) options.highThreshold = params.highThreshold

  if (Object.keys(options).length === 0) {
    throw new OperationBuildError("setSignerOptions requires at least one field to change")
  }

  return [Operation.setOptions(options)]
}

// Registry of intent.operation -> Stellar operation builder. Extend this
// when a new on-chain custody action is needed; every entry must be a pure
// function of its params so computeOperationsHash stays deterministic.
export function buildOperations(intent: EnvelopeIntent) {
  switch (intent.operation) {
    case "distribution.payment":
      return buildPayment(intent.params as unknown as PaymentParams)
    case "rotation.setSignerOptions":
    case "emergency.setSignerOptions":
      return buildSetSignerOptions(intent.params as unknown as SetSignerOptionsParams)
    default:
      throw new OperationBuildError(`No operation builder registered for "${intent.operation}"`)
  }
}

// Recomputed immediately before signing/submission and compared against the
// hash captured when the approval request was created. A mismatch means the
// operation-builder code path produced different on-chain operations than
// what signers actually approved, and finalize must refuse to sign.
export function computeOperationsHash(intent: EnvelopeIntent): string {
  const operations = buildOperations(intent)
  const encoded = operations.map((operation) => operation.toXDR("base64"))
  return canonicalHash(encoded)
}
