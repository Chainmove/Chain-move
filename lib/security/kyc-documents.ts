import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import { buildKeyring, parseAppConfig, type Keyring, type VersionedSecret } from "@/lib/config/schema"

const KYC_DOCUMENT_REF_PREFIX = "kyc-secure:"
const ENCRYPTION_ALGORITHM = "aes-256-gcm"
const ENCRYPTION_VERSION = 1

type SecureKycDocumentReference = {
  version: number
  url: string
  originalFilename: string
  contentType: string
}

type EncryptedKycDocumentEnvelope = {
  version: number
  keyVersion?: string
  iv: string
  tag: string
  contentType: string
  originalFilename: string
  data: string
}

function getKycDocumentKeyring(): Keyring {
  return buildKeyring(parseAppConfig(process.env))
}

function deriveEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest()
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}

export function createKycDocumentReference({
  url,
  originalFilename,
  contentType,
}: {
  url: string
  originalFilename: string
  contentType: string
}) {
  const payload: SecureKycDocumentReference = {
    version: ENCRYPTION_VERSION,
    url,
    originalFilename,
    contentType,
  }

  return `${KYC_DOCUMENT_REF_PREFIX}${toBase64Url(JSON.stringify(payload))}`
}

export function parseKycDocumentReference(reference: string): SecureKycDocumentReference | null {
  if (!reference.startsWith(KYC_DOCUMENT_REF_PREFIX)) return null

  try {
    const payload = JSON.parse(fromBase64Url(reference.slice(KYC_DOCUMENT_REF_PREFIX.length))) as SecureKycDocumentReference
    if (
      payload.version !== ENCRYPTION_VERSION ||
      typeof payload.url !== "string" ||
      typeof payload.originalFilename !== "string" ||
      typeof payload.contentType !== "string"
    ) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export function isAllowedKycBlobUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "https:" && /(^|.+\.)blob\.vercel-storage\.com$/i.test(url.hostname)
  } catch {
    return false
  }
}

export function isSupportedKycDocumentReference(reference: string) {
  if (parseKycDocumentReference(reference)) return true
  return isAllowedKycBlobUrl(reference)
}

export function encryptKycDocument(
  input: Buffer,
  {
    contentType,
    originalFilename,
  }: {
    contentType: string
    originalFilename: string
  },
) {
  const iv = randomBytes(12)
  const keyring = getKycDocumentKeyring()
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, deriveEncryptionKey(keyring.active.secret), iv)
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()])
  const tag = cipher.getAuthTag()

  const envelope: EncryptedKycDocumentEnvelope = {
    version: ENCRYPTION_VERSION,
    keyVersion: keyring.active.version,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    contentType,
    originalFilename,
    data: encrypted.toString("base64"),
  }

  return Buffer.from(JSON.stringify(envelope), "utf8")
}

export function decryptKycDocument(serializedEnvelope: Buffer) {
  let envelope: EncryptedKycDocumentEnvelope

  try {
    envelope = JSON.parse(serializedEnvelope.toString("utf8")) as EncryptedKycDocumentEnvelope
  } catch {
    throw new Error("Invalid encrypted KYC document payload.")
  }

  if (
    envelope.version !== ENCRYPTION_VERSION ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string" ||
    typeof envelope.contentType !== "string" ||
    typeof envelope.originalFilename !== "string"
  ) {
    throw new Error("Malformed encrypted KYC document payload.")
  }

  const keyring = getKycDocumentKeyring()
  const candidateKeys = getCandidateKeys(envelope, keyring)
  let decrypted: Buffer | null = null

  for (const key of candidateKeys) {
    try {
      const decipher = createDecipheriv(
        ENCRYPTION_ALGORITHM,
        deriveEncryptionKey(key.secret),
        Buffer.from(envelope.iv, "base64"),
      )
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))

      decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ])
      break
    } catch {
      decrypted = null
    }
  }

  if (!decrypted) {
    throw new Error("Unable to decrypt KYC document with configured key versions.")
  }

  return {
    buffer: decrypted,
    contentType: envelope.contentType,
    originalFilename: envelope.originalFilename,
  }
}

function getCandidateKeys(envelope: EncryptedKycDocumentEnvelope, keyring: Keyring): VersionedSecret[] {
  const keys = [keyring.active, ...keyring.previous]
  if (!envelope.keyVersion) return keys
  return keys.filter((key) => key.version === envelope.keyVersion)
}
