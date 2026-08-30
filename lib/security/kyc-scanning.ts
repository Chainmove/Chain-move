import KycDocument from "@/models/KycDocument"
import type { KycScanVerdict } from "@/models/KycDocument"

export type ScanResult = {
  verdict: KycScanVerdict
  details?: Record<string, unknown>
}

export type ScanHook = (
  buffer: Buffer,
  metadata: { filename: string; contentType: string; checksumSha256: string },
) => Promise<ScanResult>

let customScanHook: ScanHook | null = null

export function registerScanHook(hook: ScanHook) {
  customScanHook = hook
}

export function clearScanHook() {
  customScanHook = null
}

export async function runScanHook(
  documentId: string,
  buffer: Buffer,
  metadata: { filename: string; contentType: string; checksumSha256: string },
): Promise<ScanResult> {
  if (!customScanHook) {
    return { verdict: "clean", details: { reason: "No scan hook registered; defaulting to clean." } }
  }

  try {
    const result = await customScanHook(buffer, metadata)
    const verdict = result.verdict || "clean"

    if (verdict === "suspicious" || verdict === "malicious") {
      await KycDocument.findByIdAndUpdate(documentId, {
        status: "quarantined",
        scanVerdict: verdict,
        scanDetails: result.details || {},
        quarantinedAt: new Date(),
      })
    } else {
      await KycDocument.findByIdAndUpdate(documentId, {
        scanVerdict: verdict,
        scanDetails: result.details || {},
      })
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown scan error"
    await KycDocument.findByIdAndUpdate(documentId, {
      status: "quarantined",
      scanVerdict: "suspicious",
      scanDetails: { error: errorMessage },
      quarantinedAt: new Date(),
    })
    return { verdict: "suspicious", details: { error: errorMessage } }
  }
}

export function isDocumentAccessible(status: string): boolean {
  return status === "approved" || status === "pending"
}

export function isDocumentBlocked(status: string): boolean {
  return status === "quarantined" || status === "deleted" || status === "expired"
}
