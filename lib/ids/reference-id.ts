import { randomBytes } from "crypto"

/**
 * Format version embedded in every generated reference. Bump this if the
 * segment order, encoding, or entropy size changes, so an operator or a log
 * scanner can tell which generation this id came from at a glance.
 */
export const REFERENCE_ID_VERSION = "v1"

/** 128 bits — matches the entropy `crypto.randomUUID()` provides (122 random bits after its fixed version/variant bits), hex-encoded for a plain alphanumeric token. */
const DEFAULT_ENTROPY_BYTES = 16

export interface GenerateReferenceIdOptions {
  /** Business/domain prefix, e.g. "cm_wallet", "STL", "cm_driver_repay", "fxq". Preserved as-is so existing log/grep conventions keep working. */
  prefix: string
  /** Segment separator. Callers keep their existing convention (e.g. "-" for settlement ids, "_" elsewhere). Defaults to "_". */
  separator?: string
  /** Random bytes of CSPRNG entropy before hex-encoding. Defaults to 16 (128 bits). */
  entropyBytes?: number
}

/**
 * Generates a collision-resistant reference id: `{prefix}{sep}{version}{sep}{timestamp36}{sep}{entropyHex}`.
 *
 * The timestamp segment is kept for human sortability/debugging (an operator
 * can eyeball creation order in a log or export); it is not relied on for
 * uniqueness. Uniqueness comes entirely from the CSPRNG entropy segment
 * (`crypto.randomBytes`, not `Math.random`, which is not cryptographically
 * secure and — under concurrent workers or a seeded/deterministic runtime —
 * can repeat within the same millisecond bucket this format also uses).
 *
 * Time: O(entropyBytes) — one CSPRNG read plus fixed-count string ops, no
 * loops over input size. Space: O(entropyBytes) for the returned string.
 * With the 16-byte default this is a few hundred nanoseconds of work and a
 * ~50-character result; both are independent of caller volume.
 */
export function generateReferenceId(options: GenerateReferenceIdOptions): string {
  const separator = options.separator ?? "_"
  const entropyBytes = options.entropyBytes ?? DEFAULT_ENTROPY_BYTES
  const timestamp = Date.now().toString(36)
  const entropy = randomBytes(entropyBytes).toString("hex")
  return [options.prefix, REFERENCE_ID_VERSION, timestamp, entropy].join(separator)
}
