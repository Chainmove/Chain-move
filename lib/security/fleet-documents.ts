import { createHash } from "crypto"

export const FLEET_DOCUMENT_TYPES = ["registration", "insurance", "inspection", "ownership", "other"] as const

export type FleetDocumentType = (typeof FLEET_DOCUMENT_TYPES)[number]

export function computeChecksumSha256(input: Buffer) {
  return createHash("sha256").update(input).digest("hex")
}

export function isAllowedFleetDocumentBlobUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "https:" && /(^|.+\.)blob\.vercel-storage\.com$/i.test(url.hostname)
  } catch {
    return false
  }
}

export function isPrivateFleetDocumentBlobUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === "https:" && /\.private\.blob\.vercel-storage\.com$/i.test(url.hostname)
  } catch {
    return false
  }
}
