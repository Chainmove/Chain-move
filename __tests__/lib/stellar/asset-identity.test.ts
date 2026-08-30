import { describe, expect, it } from "vitest"
import { classifyAsset, XLM_CANONICAL_ID } from "@/lib/stellar/asset-identity"

const CANONICAL_ISSUER = "GDMXNQBJMS3FYI4PFSYCCB4XODQMNMTKFFUALHGTP3LYUHDQR55NGMH"
const SPOOF_ISSUER = "GBSPOOFERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

const config = {
  assetCode: "CMOVE",
  issuerPublicKey: CANONICAL_ISSUER,
}

describe("classifyAsset — native XLM", () => {
  it('returns verified=true and canonicalId="XLM:native" for native XLM', () => {
    const id = classifyAsset("XLM", null, config)
    expect(id.asset).toBe("XLM")
    expect(id.issuer).toBeNull()
    expect(id.verified).toBe(true)
    expect(id.canonicalId).toBe(XLM_CANONICAL_ID)
  })

  it("treats null/undefined assetCode as XLM", () => {
    expect(classifyAsset(null, null, config).asset).toBe("XLM")
    expect(classifyAsset(undefined, null, config).asset).toBe("XLM")
  })

  it("is case-insensitive for XLM", () => {
    expect(classifyAsset("xlm", null, config).verified).toBe(true)
    expect(classifyAsset("Xlm", null, config).canonicalId).toBe(XLM_CANONICAL_ID)
  })
})

describe("classifyAsset — canonical platform asset (CMOVE)", () => {
  it("returns verified=true when code and issuer both match config", () => {
    const id = classifyAsset("CMOVE", CANONICAL_ISSUER, config)
    expect(id.asset).toBe("CMOVE")
    expect(id.issuer).toBe(CANONICAL_ISSUER)
    expect(id.verified).toBe(true)
    expect(id.canonicalId).toBe(`CMOVE:${CANONICAL_ISSUER}`)
  })

  it("is case-insensitive for the asset code", () => {
    const id = classifyAsset("cmove", CANONICAL_ISSUER, config)
    expect(id.asset).toBe("CMOVE")
    expect(id.verified).toBe(true)
  })
})

describe("classifyAsset — token spoofing prevention", () => {
  it("returns verified=false when code matches but issuer differs (spoof attack)", () => {
    const id = classifyAsset("CMOVE", SPOOF_ISSUER, config)
    expect(id.asset).toBe("CMOVE")
    expect(id.issuer).toBe(SPOOF_ISSUER)
    expect(id.verified).toBe(false)
    expect(id.canonicalId).toBe(`CMOVE:${SPOOF_ISSUER}`)
  })

  it("returns verified=false when code matches but issuer is null", () => {
    const id = classifyAsset("CMOVE", null, config)
    expect(id.verified).toBe(false)
    expect(id.canonicalId).toBe("CMOVE:unknown")
  })

  it("returns verified=false for a completely different asset (USDC)", () => {
    const usdcIssuer = "GBBD47IF2H737MZRLT27725J5N5F3GZLU54B7S5XZPZ2GCK4V72UUMOO"
    const id = classifyAsset("USDC", usdcIssuer, config)
    expect(id.verified).toBe(false)
    expect(id.asset).toBe("USDC")
    expect(id.issuer).toBe(usdcIssuer)
    expect(id.canonicalId).toBe(`USDC:${usdcIssuer}`)
  })

  it("distinguishes two CMOVE tokens from different issuers by canonicalId", () => {
    const real = classifyAsset("CMOVE", CANONICAL_ISSUER, config)
    const spoof = classifyAsset("CMOVE", SPOOF_ISSUER, config)
    expect(real.canonicalId).not.toBe(spoof.canonicalId)
    expect(real.verified).toBe(true)
    expect(spoof.verified).toBe(false)
  })
})

describe("classifyAsset — missing config values", () => {
  it("returns verified=false if config.issuerPublicKey is empty", () => {
    const noIssuerConfig = { assetCode: "CMOVE", issuerPublicKey: "" }
    const id = classifyAsset("CMOVE", CANONICAL_ISSUER, noIssuerConfig)
    expect(id.verified).toBe(false)
  })

  it("returns verified=false if config.assetCode is empty", () => {
    const noCodeConfig = { assetCode: "", issuerPublicKey: CANONICAL_ISSUER }
    const id = classifyAsset("CMOVE", CANONICAL_ISSUER, noCodeConfig)
    expect(id.verified).toBe(false)
  })

  it("XLM is still verified even with an empty config", () => {
    const emptyConfig = { assetCode: "", issuerPublicKey: "" }
    const id = classifyAsset("XLM", null, emptyConfig)
    expect(id.verified).toBe(true)
  })
})
