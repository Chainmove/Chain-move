import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import mongoose from "mongoose"

import { StaticExchangeRateAdapter, TimeoutExchangeRateAdapter, type ExchangeRateProviderAdapter } from "@/lib/fx/adapters"
import { ExchangeRateQuoteService, InMemoryQuoteRepository } from "@/lib/fx/quote-service"
import { MongooseQuoteRepository } from "@/lib/fx/mongoose-quote-repository"
import { ConsumeQuoteAtomicInput, convertMajorAmount, parseDecimalToMinorUnits } from "@/lib/fx/types"
import ExchangeRateQuote from "@/models/ExchangeRateQuote"

function createService(adapters: ExchangeRateProviderAdapter[] = [new StaticExchangeRateAdapter({ "USD/NGN": 1500 })]) {
  return new ExchangeRateQuoteService(adapters, new InMemoryQuoteRepository(), {
    maxQuoteAgeMs: 60_000,
    quoteTtlMs: 60_000,
    deviationThresholdBps: 250,
    markupBps: 0,
    supportedPairs: ["USD/NGN", "NGN/USD"],
  })
}

function createBarrier(parties: number) {
  let waiting = 0
  let release: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    waiting += 1
    if (waiting === parties) release?.()
    await ready
  }
}

class BarrierQuoteRepository extends MongooseQuoteRepository {
  constructor(private readonly waitAtConsume: () => Promise<void>) {
    super()
  }

  async consume(input: ConsumeQuoteAtomicInput) {
    await this.waitAtConsume()
    return super.consume(input)
  }
}

async function connectMongo() {
  if (mongoose.connection.readyState !== 0) return

  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test", {
      serverSelectionTimeoutMS: 2000,
    })
  } catch (error) {
    console.warn("MongoDB connection warning in FX quote tests:", error)
  }
}

describe("ExchangeRateQuoteService", () => {
  beforeAll(async () => {
    await connectMongo()
  }, 10000)

  afterEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await ExchangeRateQuote.deleteMany({})
    }
  })

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  })

  it("creates and consumes fresh quotes once", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })

    expect(quote.convertedAmountMinor).toBe(1_500_000)
    const locked = await service.lockQuote(quote.id, now)

    const consumed = await service.consumeQuote({
      quoteId: locked.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      consumedBy: "txn_1",
      now,
    })

    expect(consumed.status).toBe("consumed")
    expect(consumed.consumedBy).toBe("txn_1")
    await expect(
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "txn_2",
        now,
      }),
    ).rejects.toThrow("already been consumed")

    const stored = await repository.findById(quote.id)
    expect(stored?.consumedBy).toBe("txn_1")
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

  it("rejects quotes that have not been locked before consumption", async () => {
    const service = createService()
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 1,
      now,
    })
    await expect(
      service.consumeQuote({
        quoteId: quote.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 1,
        consumedBy: "txn_locked",
        now,
      }),
    ).rejects.toThrow("must be locked")
  })

  it("rejects exact-source amount mismatches", async () => {
    const service = createService()
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
    })
    const locked = await service.lockQuote(quote.id)

    await expect(
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 9,
        consumedBy: "txn_wrong_amount",
      }),
    ).rejects.toThrow("source amount")
  })

  it("allows max-source consumption within the quoted ceiling", async () => {
    const service = createService()
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      amountPolicy: "max-source",
    })
    const locked = await service.lockQuote(quote.id)

    const consumed = await service.consumeQuote({
      quoteId: locked.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 9,
      amountPolicy: "max-source",
      consumedBy: "txn_under_limit",
    })

    expect(consumed.status).toBe("consumed")
    expect(consumed.consumedBy).toBe("txn_under_limit")
  })

  it("rejects max-source consumption above the quoted ceiling", async () => {
    const service = createService()
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      amountPolicy: "max-source",
    })
    const locked = await service.lockQuote(quote.id)

    await expect(
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 11,
        amountPolicy: "max-source",
        consumedBy: "txn_over_limit",
      }),
    ).rejects.toThrow("source amount")
  })

  it("lets exactly one concurrent in-memory consumer win", async () => {
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
    })
    const locked = await service.lockQuote(quote.id)

    const results = await Promise.allSettled([
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "txn_a",
      }),
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "txn_b",
      }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)

    const stored = await repository.findById(quote.id)
    expect(["txn_a", "txn_b"]).toContain(stored?.consumedBy)
  })

  it("lets exactly one concurrent in-memory consumer win when matching source minor units", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 3,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)

    const attempts = await Promise.allSettled([
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMinor: 300,
        consumedBy: "minor_a",
        now,
      }),
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMinor: 300,
        consumedBy: "minor_b",
        now,
      }),
    ])

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1)
  })

  it("returns a typed already-consumed result from the repository", async () => {
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)
    await service.consumeQuote({
      quoteId: locked.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      consumedBy: "txn_first",
      now,
    })

    const retry = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "txn_retry",
      now,
    })

    expect(retry).toMatchObject({ ok: false, reason: "already-consumed" })
    expect(retry.quote?.consumedBy).toBe("txn_first")
  })

  it("returns a typed conflict result for stale quote versions", async () => {
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)

    const stale = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version + 1,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "txn_stale",
      now,
    })

    expect(stale).toMatchObject({ ok: false, reason: "conflict" })
    const stored = await repository.findById(locked.id)
    expect(stored?.status).toBe("locked")
    expect(stored?.consumedBy).toBeUndefined()
  })

  it("does not let a stale in-memory update overwrite a consumed quote", async () => {
    const repository = new InMemoryQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)
    await service.consumeQuote({
      quoteId: locked.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      consumedBy: "winner_before_lock",
      now,
    })

    const staleLock = await repository.update({ ...quote, status: "locked" })

    expect(staleLock.status).toBe("consumed")
    expect(staleLock.consumedBy).toBe("winner_before_lock")
    const stored = await repository.findById(quote.id)
    expect(stored?.status).toBe("consumed")
    expect(stored?.consumedBy).toBe("winner_before_lock")
  })

  it("lets exactly one real-database consumer win with a barrier", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new BarrierQuoteRepository(createBarrier(2))
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)

    const results = await Promise.allSettled([
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "mongo_txn_a",
        now,
      }),
      service.consumeQuote({
        quoteId: locked.id,
        baseCurrency: "USD",
        quoteCurrency: "NGN",
        sourceAmountMajor: 10,
        consumedBy: "mongo_txn_b",
        now,
      }),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const stored = await ExchangeRateQuote.findById(locked.id)
    expect(stored?.status).toBe("consumed")
    expect(["mongo_txn_a", "mongo_txn_b"]).toContain(stored?.consumedBy)
    expect(stored?.version).toBe(3)
  })

  it("returns expired from the database CAS without mutating the quote", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now: new Date("2026-01-01T00:00:00.000Z"),
    })
    const locked = await service.lockQuote(quote.id, new Date("2026-01-01T00:00:00.000Z"))

    const result = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "expired_loser",
      now: new Date("2026-01-01T00:02:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, reason: "expired" })
    const stored = await ExchangeRateQuote.findById(locked.id)
    expect(stored?.status).toBe("locked")
    expect(stored?.consumedBy).toBeUndefined()
    expect(stored?.consumedAt).toBeUndefined()
  })

  it("returns conflict from the database CAS for unlocked quotes without mutating the quote", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const result = await repository.consume({
      quoteId: quote.id,
      expectedVersion: quote.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "locked_loser",
      now,
    })

    expect(result).toMatchObject({ ok: false, reason: "conflict" })
    const stored = await ExchangeRateQuote.findById(quote.id)
    expect(stored?.status).toBe("created")
    expect(stored?.consumedBy).toBeUndefined()
  })

  it("returns amount-mismatch from the database CAS without mutating the quote", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)

    const result = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 9,
      amountPolicy: "exact-source",
      consumedBy: "amount_loser",
      now,
    })

    expect(result).toMatchObject({ ok: false, reason: "amount-mismatch" })
    const stored = await ExchangeRateQuote.findById(locked.id)
    expect(stored?.status).toBe("locked")
    expect(stored?.consumedBy).toBeUndefined()
  })

  it("returns conflict from the database CAS for mismatched quote terms", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)

    const result = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "NGN",
      quoteCurrency: "USD",
      direction: "inverse",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "terms_loser",
      now,
    })

    expect(result).toMatchObject({ ok: false, reason: "conflict" })
    const stored = await ExchangeRateQuote.findById(locked.id)
    expect(stored?.status).toBe("locked")
    expect(stored?.consumedBy).toBeUndefined()
  })

  it("does not overwrite database consumer details on retry", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const firstConsumeAt = new Date("2026-01-01T00:00:10.000Z")
    const retryAt = new Date("2026-01-01T00:00:20.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now: new Date("2026-01-01T00:00:00.000Z"),
    })
    const locked = await service.lockQuote(quote.id, new Date("2026-01-01T00:00:00.000Z"))

    const consumed = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "winner_txn",
      now: firstConsumeAt,
    })
    expect(consumed).toMatchObject({ ok: true })

    const retry = await repository.consume({
      quoteId: locked.id,
      expectedVersion: locked.version,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      direction: "direct",
      sourceAmountMajor: 10,
      amountPolicy: "exact-source",
      consumedBy: "retry_txn",
      now: retryAt,
    })

    expect(retry).toMatchObject({ ok: false, reason: "already-consumed" })
    const stored = await ExchangeRateQuote.findById(locked.id)
    expect(stored?.consumedBy).toBe("winner_txn")
    expect(stored?.consumedAt?.toISOString()).toBe(firstConsumeAt.toISOString())
    expect(stored?.version).toBe(3)
  })

  it("does not let a stale database update overwrite a consumed quote", async () => {
    if (mongoose.connection.readyState !== 1) return

    const repository = new MongooseQuoteRepository()
    const service = new ExchangeRateQuoteService([new StaticExchangeRateAdapter({ "USD/NGN": 1500 })], repository, {
      maxQuoteAgeMs: 60_000,
      quoteTtlMs: 60_000,
      deviationThresholdBps: 250,
      markupBps: 0,
      supportedPairs: ["USD/NGN", "NGN/USD"],
    })
    const now = new Date("2026-01-01T00:00:00.000Z")
    const quote = await service.createQuote({
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      now,
    })
    const locked = await service.lockQuote(quote.id, now)
    await service.consumeQuote({
      quoteId: locked.id,
      baseCurrency: "USD",
      quoteCurrency: "NGN",
      sourceAmountMajor: 10,
      consumedBy: "db_winner_before_lock",
      now,
    })

    const staleLock = await repository.update({ ...quote, status: "locked" })

    expect(staleLock.status).toBe("consumed")
    expect(staleLock.consumedBy).toBe("db_winner_before_lock")
    const stored = await ExchangeRateQuote.findById(quote.id)
    expect(stored?.status).toBe("consumed")
    expect(stored?.consumedBy).toBe("db_winner_before_lock")
    expect(stored?.version).toBe(3)
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
    expect(parseDecimalToMinorUnits("1.05", "USD")).toBe(105)
    expect(() => parseDecimalToMinorUnits("1.005", "USD")).toThrow("at most 2 decimal")
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
