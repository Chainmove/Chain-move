import { describe, expect, it } from "vitest"

import { isAllowedKycBlobUrl, isPrivateKycBlobUrl } from "@/lib/security/kyc-documents"

describe("KYC private storage URL policy", () => {
  it("recognizes authenticated private Blob URLs", () => {
    const url = "https://store.private.blob.vercel-storage.com/kyc/user/document.json"
    expect(isAllowedKycBlobUrl(url)).toBe(true)
    expect(isPrivateKycBlobUrl(url)).toBe(true)
  })

  it("keeps legacy public URLs distinguishable for migration", () => {
    const url = "https://store.public.blob.vercel-storage.com/kyc/user/document.json"
    expect(isAllowedKycBlobUrl(url)).toBe(true)
    expect(isPrivateKycBlobUrl(url)).toBe(false)
  })

  it("rejects lookalike and non-HTTPS hosts", () => {
    expect(isAllowedKycBlobUrl("https://blob.vercel-storage.com.attacker.example/kyc.json")).toBe(false)
    expect(isPrivateKycBlobUrl("http://store.private.blob.vercel-storage.com/kyc.json")).toBe(false)
  })
})
