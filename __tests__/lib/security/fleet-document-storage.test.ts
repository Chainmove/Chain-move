import { describe, expect, it } from "vitest"

import {
  computeChecksumSha256,
  isAllowedFleetDocumentBlobUrl,
  isPrivateFleetDocumentBlobUrl,
} from "@/lib/security/fleet-documents"

describe("Fleet document private storage URL policy", () => {
  it("recognizes authenticated private Blob URLs", () => {
    const url = "https://store.private.blob.vercel-storage.com/fleet-documents/vehicle/document.png"
    expect(isAllowedFleetDocumentBlobUrl(url)).toBe(true)
    expect(isPrivateFleetDocumentBlobUrl(url)).toBe(true)
  })

  it("does not treat public Blob URLs as private", () => {
    const url = "https://store.public.blob.vercel-storage.com/fleet-documents/vehicle/document.png"
    expect(isAllowedFleetDocumentBlobUrl(url)).toBe(true)
    expect(isPrivateFleetDocumentBlobUrl(url)).toBe(false)
  })

  it("rejects lookalike and non-HTTPS hosts", () => {
    expect(isAllowedFleetDocumentBlobUrl("https://blob.vercel-storage.com.attacker.example/doc.png")).toBe(false)
    expect(isPrivateFleetDocumentBlobUrl("http://store.private.blob.vercel-storage.com/doc.png")).toBe(false)
  })
})

describe("Fleet document checksums", () => {
  it("produces a stable sha256 hex digest", () => {
    const digest = computeChecksumSha256(Buffer.from("fleet-document-contents"))
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).toBe(computeChecksumSha256(Buffer.from("fleet-document-contents")))
  })
})
