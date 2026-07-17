type Provider = "paystack" | "privy" | "resend" | "stellar"
type FailureMode = "timeout" | "rejected" | "malformed"

export class ProviderHarness {
  private failures = new Map<Provider, FailureMode>()
  readonly calls: Array<{ provider: Provider; operation: string }> = []

  failNext(provider: Provider, mode: FailureMode = "rejected") {
    this.failures.set(provider, mode)
  }

  private consume(provider: Provider, operation: string) {
    this.calls.push({ provider, operation })
    const mode = this.failures.get(provider)
    this.failures.delete(provider)
    if (mode === "timeout") throw new Error(provider + " mock timeout")
    if (mode === "rejected") throw new Error(provider + " mock rejected request")
    return mode
  }

  paystack = async (operation = "initialize") => {
    const mode = this.consume("paystack", operation)
    return mode === "malformed" ? { status: true } : {
      status: true,
      data: { reference: "paystack_ref", authorization_url: "http://paystack.test/authorize" },
    }
  }

  privy = async (operation = "verify-token") => {
    const mode = this.consume("privy", operation)
    return mode === "malformed" ? {} : { sub: "did:privy:integration-user", email: "fixture@example.test" }
  }

  resend = async (operation = "send") => {
    const mode = this.consume("resend", operation)
    return mode === "malformed" ? {} : { id: "email_fixture_id" }
  }

  stellar = async (operation = "submit") => {
    const mode = this.consume("stellar", operation)
    return mode === "malformed" ? {} : { hash: "stellar_fixture_hash", successful: true }
  }

  installFetchGuard() {
    const allowed = new Map<string, () => Promise<unknown>>([
      ["https://api.paystack.co/transaction/initialize", () => this.paystack()],
    ])
    globalThis.fetch = async input => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const adapter = allowed.get(url)
      if (!adapter) throw new Error("Unhandled integration-test network request: " + new URL(url).origin)
      try {
        return Response.json(await adapter())
      } catch (error) {
        return Response.json(
          { status: false, message: error instanceof Error ? error.message : "mock failure" },
          { status: 503 },
        )
      }
    }
  }
}
