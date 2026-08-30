import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const KEY_LENGTH = 32
const ENCRYPTION_VERSION = 1

export type EncryptedPayload = {
  version: number
  iv: string
  tag: string
  data: string
  keyVersion: string
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest().subarray(0, KEY_LENGTH)
}

export function encryptBuffer(
  input: Buffer,
  secret: string,
  keyVersion: string,
): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(secret)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()])
  const tag = cipher.getAuthTag()

  const payload: EncryptedPayload = {
    version: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
    keyVersion,
  }

  return Buffer.from(JSON.stringify(payload), "utf8")
}

export function decryptBuffer(
  input: Buffer,
  secret: string,
): { buffer: Buffer; keyVersion: string } {
  let payload: EncryptedPayload

  try {
    payload = JSON.parse(input.toString("utf8"))
  } catch {
    throw new Error("Invalid encrypted backup payload: not valid JSON.")
  }

  if (
    payload.version !== ENCRYPTION_VERSION ||
    typeof payload.iv !== "string" ||
    typeof payload.tag !== "string" ||
    typeof payload.data !== "string" ||
    typeof payload.keyVersion !== "string"
  ) {
    throw new Error("Malformed encrypted backup payload structure.")
  }

  const key = deriveKey(secret)
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"))
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"))

  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final(),
    ])
    return { buffer: decrypted, keyVersion: payload.keyVersion }
  } catch {
    throw new Error("Decryption failed: incorrect key or corrupted data.")
  }
}

export function computeChecksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

export function computeFileChecksum(filePath: string, data: Buffer): string {
  return computeChecksum(data)
}
