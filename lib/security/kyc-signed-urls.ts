import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import { parseAppConfig } from "@/lib/config/schema"

const SIGNED_URL_TTL_SECONDS = 5 * 60
const SIGNED_URL_SEPARATOR = "|"

type SigningKey = { id: string; secret: string }
type SigningKeyring = { active: SigningKey; previous: SigningKey[] }

function getSigningKeyring(): SigningKeyring {
  const config = parseAppConfig(process.env)

  if (config.KYC_DOCUMENT_SIGNING_KEYS_JSON) {
    let parsed: SigningKeyring
    try {
      parsed = JSON.parse(config.KYC_DOCUMENT_SIGNING_KEYS_JSON) as SigningKeyring
    } catch {
      throw new Error("KYC document signing keyring must be valid JSON.")
    }

    const keys = [parsed.active, ...(parsed.previous || [])]
    if (!parsed.active || keys.some((key) => !key?.id || !key.secret || key.secret.length < 16)) {
      throw new Error("KYC document signing keyring contains an invalid key.")
    }
    if (new Set(keys.map((key) => key.id)).size !== keys.length) {
      throw new Error("KYC document signing key IDs must be unique.")
    }
    return { active: parsed.active, previous: parsed.previous || [] }
  }

  const secret = config.KYC_DOCUMENT_SIGNING_KEY
  if (!secret || secret.length < 16) {
    throw new Error("KYC_DOCUMENT_SIGNING_KEY must be configured with at least 16 characters.")
  }

  return {
    active: { id: config.KYC_DOCUMENT_SIGNING_KEY_ID || "document-url-v1", secret },
    previous: [],
  }
}

export type SignedUrlPayload = {
  documentId: string
  userId: string
  expiresAt: number
  nonce: string
  keyId: string
}

export function createSignedDocumentUrl(
  documentId: string,
  userId: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): { url: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const nonce = randomBytes(16).toString("hex")
  const keyring = getSigningKeyring()

  const payload: SignedUrlPayload = {
    documentId,
    userId,
    expiresAt,
    nonce,
    keyId: keyring.active.id,
  }

  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson).toString("base64url")
  const signature = createHmac("sha256", keyring.active.secret).update(payloadBase64).digest("base64url")

  const token = `${keyring.active.id}${SIGNED_URL_SEPARATOR}${payloadBase64}${SIGNED_URL_SEPARATOR}${signature}`
  const url = `/api/kyc-documents/${documentId}?token=${encodeURIComponent(token)}`

  return { url, expiresAt }
}

export function verifySignedDocumentUrl(
  token: string,
): { valid: boolean; payload?: SignedUrlPayload; error?: string } {
  const parts = token.split(SIGNED_URL_SEPARATOR)
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format." }
  }

  const [keyId, payloadBase64, signatureBase64] = parts
  const keyring = getSigningKeyring()
  const signingKey = [keyring.active, ...keyring.previous].find((key) => key.id === keyId)
  if (!signingKey) {
    return { valid: false, error: "Unknown or retired signing key." }
  }

  const expectedSignature = createHmac("sha256", signingKey.secret).update(payloadBase64).digest("base64url")

  let signatureValid = false
  try {
    const sigBuf = Buffer.from(signatureBase64, "base64url")
    const expectedBuf = Buffer.from(expectedSignature, "base64url")
    if (sigBuf.length === expectedBuf.length) {
      signatureValid = timingSafeEqual(sigBuf, expectedBuf)
    }
  } catch {
    return { valid: false, error: "Invalid signature." }
  }

  if (!signatureValid) {
    return { valid: false, error: "Invalid signature." }
  }

  let payload: SignedUrlPayload
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"))
  } catch {
    return { valid: false, error: "Invalid payload." }
  }

  if (!payload.documentId || !payload.userId || !payload.expiresAt || !payload.nonce || payload.keyId !== keyId) {
    return { valid: false, error: "Incomplete payload." }
  }

  if (Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return { valid: false, error: "Signed URL has expired." }
  }

  return { valid: true, payload }
}

export const DOCUMENT_URL_TTL_SECONDS = SIGNED_URL_TTL_SECONDS
