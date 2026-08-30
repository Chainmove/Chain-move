// Shared types for the issuer/distribution custody control plane (threshold
// signing + safe key rotation). See docs/custody-signer-rotation.md.

export type OperationCategory = "issuance" | "payout" | "emergency" | "recovery" | "rotation"

export type SignerRole = "issuer" | "distribution" | "security" | "recovery"

export type QuorumType = "standard" | "recovery"

export type SignerSetStatus = "pending" | "active" | "retiring" | "retired" | "rolled_back"

export type ApprovalRequestStatus =
  | "pending"
  | "quorum_reached"
  | "submitting"
  | "submitted"
  | "failed"
  | "expired"

export interface EnvelopeMemo {
  type: "none" | "text" | "id" | "hash"
  value?: string
}

// The business intent an envelope carries. `params` is operation-specific and
// is hashed as part of the envelope; it is never a substitute for the actual
// operations built by `lib/custody/operations.ts`.
export interface EnvelopeIntent {
  category: OperationCategory
  operation: string
  params: Record<string, unknown>
}

export interface CustodyEnvelope {
  network: string
  networkPassphrase: string
  sourceAccount: string
  sequence: string
  minTime: string
  maxTime: string
  memo: EnvelopeMemo
  intent: EnvelopeIntent
}

export interface SignerDescriptor {
  signerId: string
  role: SignerRole
  publicKey: string
  weight: number
}

// A signing backend never returns raw key material to the caller. Only a
// public key and a detached signature ever cross this boundary.
export interface SignerAdapter {
  readonly adapterId: string
  getPublicKey(signerId: string): Promise<string>
  sign(signerId: string, payloadHash: string): Promise<string>
}
