import { describe, expect, it } from "vitest"

import { StaticExchangeRateAdapter, TimeoutExchangeRateAdapter, type ExchangeRateProviderAdapter } from "@/lib/fx/adapters"
import { ExchangeRateQuoteService, InMemoryQuoteRepository } from "@/lib/fx/quote-service"
import { convertMajorAmount } from "@/lib/fx/types"

function createService(adapters: ExchangeRateProviderAdapter[] = [new StaticExchangeRateAdapter({ "USD/NGN": 1500 })]) {
  return new ExchangeRateQuoteService(adapters, new InMemoryQuoteRepository(), {
    maxQuoteAgeMs: 60_000,
    quoteTtlMs: 60_000,
    deviationThresholdBps: 250,
    markupBps: 0,
    supportedPairs: ["USD/NGN", "NGN/USD"],
  })
}

describe("ExchangeRateQuoteService", () => {
  it("creates and consumes fresh quotes once", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const service = createService()
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })

    expect(quote.convertedAmountMinor).toBe(1_500_000)

    const consumed = await service.consumeQuote({
      quoteId: quote.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      consumedBy: "txn_1",
      now,
    })

    expect(consumed.status).toBe("consumed")
    await expect(
      service.consumeQuote({
        quoteId: quote.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "txn_2",
        now,
      }),
    ).rejects.toThrow("already been consumed")
  })

  it("rejects expired quotes", async () => {
    const service = createService()
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    })

    await expect(
      service.consumeQuote({
        quoteId: quote.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 1,
        consumedBy: "txn_1",
        now: new Date("2026-01-01T00:02:00.000Z"),
      }),
    ).rejects.toThrow("expired")
  })

  it("supports inverse pairs through the static adapter", async () => {
    const service = createService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })])
    const quote = await service.createQuote({
      baseCurrency: "NGN",
      quoteCurrency: "USD",
      sourceAmountMajor: 1500,
    })

    expect(quote.convertedAmountMinor).toBe(100)
  })

  it("falls back after provider timeout", async () => {
    const service = createService([
      new TimeoutExchangeRateAdapter(),
      new StaticExchangeRateAdapter({ "USD/NGN": 1500 }, "fallback"),
    ])

    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 2,
    })

    expect(quote.provider).toBe("fallback")
    expect(quote.convertedAmountMajor).toBe(3000)
  })

  it("deduplicates idempotency keys", async () => {
    const service = createService()
    const first = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 5,
      idempotencyKey: "idem-1",
    })
    const second = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 5,
      idempotencyKey: "idem-1",
    })

    expect(second.id).toBe(first.id)
  })

  it("uses deterministic minor-unit rounding and rejects invalid rates", () => {
    expect(
      convertMajorAmount({
        amountMajor: 1.005,
        rate: 1500,
        sourceCurrency: "USD",
        targetCurrency: "NGN",
      }).convertedAmountMinor,
    ).toBe(150_750)

    expect(() =>
      convertMajorAmount({
        amountMajor: 1,
        rate: Number.NaN,
        sourceCurrency: "USD",
        targetCurrency: "NGN",
      }),
    ).toThrow("positive and finite")
  })
})
