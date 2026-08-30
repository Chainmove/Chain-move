/**
 * Multi-factor verification for wallet recovery.
 *
 * Four independent factors are required — no single factor or actor can
 * approve a recovery alone:
 *
 *   1. session         — user authenticates with current Privy session
 *   2. contact_channel — email or SMS OTP confirms intent
 *   3. guardian_key    — HMAC proof from a pre-registered recovery key
 *   4. high_risk_review — manual approval by an authorized admin reviewer
 */

import { createHmac, timingSafeEqual, randomBytes } from "crypto"
import type { IRecoveryFactor, FactorType } from "@/models/WalletRecovery"

export const REQUIRED_FACTORS: ReadonlyArray<FactorType> = [
  "session",
  "contact_channel",
  "guardian_key",
  "high_risk_review",
]

export const PRE_COOLING_FACTORS: ReadonlyArray<FactorType> = [
  "session",
  "contact_channel",
  "guardian_key",
]

export const FINAL_GATE_FACTOR: FactorType = "high_risk_review"

function getHmacSecret(): string {
  return process.env.RECOVERY_HMAC_SECRET || process.env.JWT_SECRET || "recovery-hmac-fallback"
}

// ── Guardian key ──────────────────────────────────────────────────────────────

export function generateGuardianKey(): string {
  return randomBytes(32).toString("base64url")
}

export function deriveGuardianKeyFingerprint(
  rawKey: string,
  userId: string,
  nonce: string,
): string {
  return createHmac("sha256", getHmacSecret())
    .update(`${userId}:${nonce}:${rawKey}`)
    .digest("hex")
}

export function verifyGuardianKeyProof(
  submittedKey: string,
  expectedFingerprint: string,
  userId: string,
  nonce: string,
): boolean {
  const submitted = deriveGuardianKeyFingerprint(submittedKey, userId, nonce)
  try {
    return timingSafeEqual(Buffer.from(submitted, "hex"), Buffer.from(expectedFingerprint, "hex"))
  } catch {
    return false
  }
}

// ── Contact-channel OTP ───────────────────────────────────────────────────────

export function generateOtp(): string {
  const bytes = randomBytes(3)
  const num = ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) % 1_000_000
  return num.toString().padStart(6, "0")
}

export function hashOtp(otp: string, nonce: string): string {
  return createHmac("sha256", getHmacSecret()).update(`${nonce}:${otp}`).digest("hex")
}

export function verifyOtp(submittedOtp: string, storedHash: string, nonce: string): boolean {
  const submitted = hashOtp(submittedOtp, nonce)
  try {
    return timingSafeEqual(Buffer.from(submitted, "hex"), Buffer.from(storedHash, "hex"))
  } catch {
    return false
  }
}

// ── Factor helpers ────────────────────────────────────────────────────────────

export function buildInitialFactors(): IRecoveryFactor[] {
  return REQUIRED_FACTORS.map((type) => ({ type, verified: false }))
}

export function allPreCoolingFactorsVerified(factors: IRecoveryFactor[]): boolean {
  return PRE_COOLING_FACTORS.every((required) =>
    factors.some((f) => f.type === required && f.verified),
  )
}

export function finalGateVerified(factors: IRecoveryFactor[]): boolean {
  return factors.some((f) => f.type === FINAL_GATE_FACTOR && f.verified)
}

export function allFactorsVerified(factors: IRecoveryFactor[]): boolean {
  return REQUIRED_FACTORS.every((required) =>
    factors.some((f) => f.type === required && f.verified),
  )
}

export function getUnverifiedFactors(factors: IRecoveryFactor[]): FactorType[] {
  const verified = new Set(factors.filter((f) => f.verified).map((f) => f.type))
  return REQUIRED_FACTORS.filter((r) => !verified.has(r))
}
