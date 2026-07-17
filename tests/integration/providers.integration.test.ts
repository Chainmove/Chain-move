import { describe, expect, it } from "vitest"
import { ProviderHarness } from "./harness/providers"

describe("provider adapters", () => {
  it.each([
    ["paystack", "paystack"],
    ["privy", "privy"],
    ["resend", "resend"],
    ["stellar", "stellar"],
  ] as const)("injects a readable failure for %s without fixture secrets", async (_label, provider) => {
    const harness = new ProviderHarness()
    harness.failNext(provider, "rejected")
    await expect(harness[provider]()).rejects.toThrow(provider + " mock rejected request")
  })

  it("fails closed on unhandled external network requests", async () => {
    const harness = new ProviderHarness()
    harness.installFetchGuard()
    await expect(fetch("https://unapproved.example.test/data")).rejects.toThrow(
      "Unhandled integration-test network request: https://unapproved.example.test",
    )
  })
})
