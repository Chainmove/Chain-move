import { describe, expect, it } from "vitest"

import { buildKeyring, getRedactedConfigDiagnostics, parseAppConfig } from "@/lib/config/schema"

const baseEnv: Record<string, unknown> = {
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/chainmove",
  JWT_SECRET: "local-development-secret-with-enough-length",
  ENABLE_MOCK_PAYMENTS: "true",
  ENABLE_MOCK_EMAILS: "true",
  ENABLE_MOCK_STELLAR: "true",
}

describe("configuration schema", () => {
  it("accepts local mock configuration", () => {
    const config = parseAppConfig(baseEnv)
    expect(config.ENABLE_MOCK_PAYMENTS).toBe(true)
  })

  it("rejects production placeholders and mock flags", () => {
    expect(() =>
      parseAppConfig({
        ...baseEnv,
        NODE_ENV: "production",
        JWT_SECRET: "replace_with_secret",
        AUTH_SESSION_SECRET: "replace_with_secret",
        PRIVY_APP_SECRET: "replace_with_secret",
        PAYSTACK_SECRET_KEY: "replace_with_secret",
        RESEND_API_KEY: "replace_with_secret",
        BLOB_READ_WRITE_TOKEN: "replace_with_secret",
        ENABLE_MOCK_PAYMENTS: "true",
      }),
    ).toThrow("Invalid ChainMove configuration")
  })

  it("builds active and previous key versions without leaking values", () => {
    const config = parseAppConfig({
      ...baseEnv,
      KYC_ENCRYPTION_KEYS_JSON: JSON.stringify({
        active: { version: "kyc-v2", secret: "active-secret-value-with-length" },
        previous: [{ version: "kyc-v1", secret: "previous-secret-value-with-length" }],
      }),
    })

    const keyring = buildKeyring(config)
    const diagnostics = getRedactedConfigDiagnostics(config, keyring)
    expect(keyring.active.version).toBe("kyc-v2")
    expect(diagnostics.keyVersions.kycPrevious).toEqual(["kyc-v1"])
    expect(JSON.stringify(diagnostics)).not.toContain("active-secret")
  })
})
