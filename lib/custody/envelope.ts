import { Networks } from "@stellar/stellar-sdk"
import { getStellarConfig } from "@/lib/stellar/config"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import { canonicalHash } from "./canonical"
import type { CustodyEnvelope, EnvelopeIntent, EnvelopeMemo } from "./types"

export class EnvelopeValidationError extends Error {}

const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
}

export function getNetworkPassphrase(network: string): string {
  const passphrase = NETWORK_PASSPHRASES[network]
  if (!passphrase) {
    throw new EnvelopeValidationError(`Unsupported network: ${network}`)
  }
  return passphrase
}

export interface BuildEnvelopeInput {
  sourceAccount: string
  sequence: string
  minTime: Date
  maxTime: Date
  memo?: EnvelopeMemo
  intent: EnvelopeIntent
  env?: NodeJS.ProcessEnv
}

// Binds network, source account, sequence, time bounds, memo, and intent
// into one canonical structure. The resulting hash (computeEnvelopeHash) is
// the unit of replay protection: it can never be reused across networks or
// intents because both are inputs to the hash.
export function buildEnvelope(input: BuildEnvelopeInput): CustodyEnvelope {
  const config = getStellarConfig(input.env)
  const sourceAccount = normalizeStellarPublicKey(input.sourceAccount)
  if (!isValidStellarPublicKey(sourceAccount)) {
    throw new EnvelopeValidationError("Invalid envelope source account")
  }
  if (!/^\d+$/.test(input.sequence)) {
    throw new EnvelopeValidationError("Envelope sequence must be a non-negative integer string")
  }
  if (input.maxTime.getTime() <= input.minTime.getTime()) {
    throw new EnvelopeValidationError("Envelope maxTime must be after minTime")
  }
  if (!input.intent.operation || !input.intent.category) {
    throw new EnvelopeValidationError("Envelope intent requires a category and operation")
  }

  return {
    network: config.network,
    networkPassphrase: getNetworkPassphrase(config.network),
    sourceAccount,
    sequence: input.sequence,
    minTime: input.minTime.toISOString(),
    maxTime: input.maxTime.toISOString(),
    memo: input.memo ?? { type: "none" },
    intent: input.intent,
  }
}

export function computeEnvelopeHash(envelope: CustodyEnvelope): string {
  return canonicalHash(envelope)
}

export interface EnvelopeFreshnessInput {
  envelope: CustodyEnvelope
  now?: Date
  lastConsumedSequence?: string
  env?: NodeJS.ProcessEnv
}

// Rejects cross-network replay (network/passphrase must match the currently
// configured network), expired or not-yet-valid approval windows, and
// stale/replayed sequence numbers. Cross-intent replay is rejected
// separately by recomputing the operations hash immediately before signing
// (see lib/custody/operations.ts computeOperationsHash).
export function assertEnvelopeFresh(input: EnvelopeFreshnessInput): void {
  const config = getStellarConfig(input.env)
  const now = input.now ?? new Date()

  if (input.envelope.network !== config.network) {
    throw new EnvelopeValidationError(
      `Cross-network replay rejected: envelope network "${input.envelope.network}" does not match configured network "${config.network}"`,
    )
  }
  if (input.envelope.networkPassphrase !== getNetworkPassphrase(config.network)) {
    throw new EnvelopeValidationError("Cross-network replay rejected: network passphrase mismatch")
  }

  const minTime = new Date(input.envelope.minTime)
  const maxTime = new Date(input.envelope.maxTime)
  if (now.getTime() < minTime.getTime()) {
    throw new EnvelopeValidationError("Envelope is not yet valid (before minTime)")
  }
  if (now.getTime() > maxTime.getTime()) {
    throw new EnvelopeValidationError("Envelope has expired (past maxTime); replay rejected")
  }

  if (input.lastConsumedSequence !== undefined) {
    const sequence = BigInt(input.envelope.sequence)
    const watermark = BigInt(input.lastConsumedSequence)
    if (sequence <= watermark) {
      throw new EnvelopeValidationError(
        `Stale sequence rejected: envelope sequence ${sequence} is not greater than last consumed sequence ${watermark}`,
      )
    }
  }
}
