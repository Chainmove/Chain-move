import { timingSafeEqual } from "crypto"

const HEX_PATTERN = /^[0-9a-f]+$/i

/**
 * Length-checked `crypto.timingSafeEqual`. `timingSafeEqual` throws a
 * RangeError (`ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`) when the two buffers
 * differ in length rather than returning false, so every caller must guard
 * on length first. That guard is a variable-time `.length` read, which in
 * the strictest theoretical model is itself a (much smaller) timing
 * signal — see the "known limitation" note in implementation.md. For both
 * call sites this module serves, the expected value's length is either
 * public (a fixed HMAC digest size) or, at worst, only reveals a secret's
 * *length*, never its content; the byte comparison downstream — the part
 * that could otherwise leak content via early-exit — is unconditionally
 * constant-time.
 */
function timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Constant-time comparison of a candidate hex string (e.g. a webhook's
 * `x-...-signature` header) against an expected hex-encoded digest.
 *
 * Malformed input — missing, wrong length, or containing non-hex
 * characters — is rejected before any byte comparison runs. This is
 * deliberately an explicit charset/length check rather than relying on
 * `Buffer.from(x, "hex")`'s behavior on invalid input: Node's hex decoder
 * does not throw on a malformed string, it silently stops decoding at the
 * first invalid byte pair and returns a truncated buffer, which is a
 * surprising, easy-to-misread implicit safety net to depend on. Validating
 * the format up front keeps the "malformed" case an explicit, auditable
 * branch instead of an accident of decoder behavior — and the check itself
 * does not touch the expected digest's bytes, so it introduces no new
 * timing signal about the secret.
 *
 * Time: O(n) in the candidate's length for the regex/length checks, plus
 * O(n) for the fixed-time byte comparison once both sides are confirmed
 * equal-length and well-formed — no branch depends on the *content* of a
 * correctly-shaped candidate. Space: O(n) for the two decoded buffers.
 */
export function timingSafeEqualHex(candidate: string | null | undefined, expectedHex: string): boolean {
  if (!candidate) return false
  if (candidate.length !== expectedHex.length) return false
  if (!HEX_PATTERN.test(candidate)) return false
  return timingSafeEqualBuffers(Buffer.from(candidate, "hex"), Buffer.from(expectedHex, "hex"))
}

/**
 * Constant-time comparison of a candidate secret/bearer-credential string
 * (e.g. a full `Authorization: Bearer <token>` header value) against an
 * expected string, compared as raw UTF-8 bytes.
 *
 * The full string is compared as one unit — including any `Bearer `
 * prefix — rather than checking the prefix separately and only
 * timing-safe-comparing the token portion. That two-step shape is a common
 * source of subtle bugs (a variable-time prefix check followed by a
 * correct constant-time suffix check still only protects the suffix); a
 * single whole-string comparison has no such seam.
 *
 * Time/space: same O(n) shape as `timingSafeEqualHex` above, with no
 * charset restriction — every string is valid UTF-8, so there is no
 * "malformed encoding" case here beyond length, which is already handled.
 */
export function timingSafeEqualString(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false
  return timingSafeEqualBuffers(Buffer.from(candidate, "utf8"), Buffer.from(expected, "utf8"))
}
