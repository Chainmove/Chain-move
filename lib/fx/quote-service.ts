import { ExchangeRateProviderAdapter } from "@/lib/fx/adapters"
import {
  AmountPolicy,
  ConsumeQuoteAtomicInput,
  ConsumeQuoteAtomicResult,
  CurrencyCode,
  ExchangeRateQuoteSnapshot,
  QuoteConsumeFailureReason,
  QuoteDirection,
  assertCurrency,
  convertMajorAmount,
  isValidRate,
} from "@/lib/fx/types"

export type QuoteServiceConfig = {
  maxQuoteAgeMs: number
  quoteTtlMs: number
  deviationThresholdBps: number
  markupBps: number
  supportedPairs: readonly string[]
}

export interface QuoteRepository {
  create(snapshot: ExchangeRateQuoteSnapshot): Promise<ExchangeRateQuoteSnapshot>
  findById(id: string): Promise<ExchangeRateQuoteSnapshot | null>
  findByIdempotencyKey(key: string): Promise<ExchangeRateQuoteSnapshot | null>
  update(snapshot: ExchangeRateQuoteSnapshot): Promise<ExchangeRateQuoteSnapshot>
  consume(input: ConsumeQuoteAtomicInput): Promise<ConsumeQuoteAtomicResult>
}

export class InMemoryQuoteRepository implements QuoteRepository {
  private readonly quotes = new Map<string, ExchangeRateQuoteSnapshot>()

  async create(snapshot: ExchangeRateQuoteSnapshot) {
    this.quotes.set(snapshot.id, structuredClone(snapshot))
    return structuredClone(snapshot)
  }

  async findById(id: string) {
    const quote = this.quotes.get(id)
    return quote ? structuredClone(quote) : null
  }

  async findByIdempotencyKey(key: string) {
    for (const quote of this.quotes.values()) {
      if (quote.idempotencyKey === key) return structuredClone(quote)
    }
    return null
  }

  async update(snapshot: ExchangeRateQuoteSnapshot) {
    if (snapshot.status === "consumed") {
      throw new Error("Use atomic consume to consume quotes.")
    }

    const current = this.quotes.get(snapshot.id)
    if (current?.status === "consumed" || (current && current.version !== snapshot.version)) {
      return structuredClone(current)
    }

    const updated = {
      ...snapshot,
      version: (current?.version ?? snapshot.version) + 1,
    }
    this.quotes.set(snapshot.id, structuredClone(updated))
    return structuredClone(updated)
  }

  async consume(input: ConsumeQuoteAtomicInput) {
    const quote = this.quotes.get(input.quoteId)
    if (!quote) return { ok: false as const, reason: "not-found" as const }

    if (quote.status === "consumed") {
      return { ok: false as const, reason: "already-consumed" as const, quote: structuredClone(quote) }
    }

    if (quote.expiresAt.getTime() < input.now.getTime() || quote.status === "expired") {
      return { ok: false as const, reason: "expired" as const, quote: structuredClone(quote) }
    }

    if (quote.status !== "locked") {
      return { ok: false as const, reason: "conflict" as const, quote: structuredClone(quote) }
    }

    const amountMatches = this.amountMatches(quote, input)

    if (!amountMatches) {
      return { ok: false as const, reason: "amount-mismatch" as const, quote: structuredClone(quote) }
    }

    if (
      quote.version !== input.expectedVersion ||
      quote.baseCurrency !== input.baseCurrency ||
      quote.quoteCurrency !== input.quoteCurrency ||
      quote.direction !== input.direction ||
      quote.amountPolicy !== input.amountPolicy ||
      quote.status !== "locked"
    ) {
      return { ok: false as const, reason: "conflict" as const, quote: structuredClone(quote) }
    }

    const consumed = {
      ...quote,
      version: quote.version + 1,
      status: "consumed" as const,
      consumedAt: input.now,
      consumedBy: input.consumedBy,
    }
    this.quotes.set(input.quoteId, structuredClone(consumed))
    return { ok: true as const, quote: structuredClone(consumed) }
  }

  private amountMatches(quote: ExchangeRateQuoteSnapshot, input: ConsumeQuoteAtomicInput) {
    if (input.sourceAmountMinor !== undefined) {
      return quote.amountPolicy === "exact-source"
        ? quote.sourceAmountMinor === input.sourceAmountMinor
        : quote.sourceAmountMinor >= input.sourceAmountMinor
    }

    if (input.sourceAmountMajor === undefined) return false

    return quote.amountPolicy === "exact-source"
      ? quote.sourceAmountMajor === input.sourceAmountMajor
      : quote.sourceAmountMajor >= input.sourceAmountMajor
  }
}

function nowMs(date: Date) {
  return date.getTime()
}

function deviationBps(a: number, b: number) {
  return Math.abs(a - b) / Math.min(a, b) * 10_000
}

function makeId() {
  return `fxq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export class ExchangeRateQuoteService {
  constructor(
    private readonly providers: readonly ExchangeRateProviderAdapter[],
    private readonly repository: QuoteRepository,
    private readonly config: QuoteServiceConfig,
  ) {}

  async createQuote(input: {
    baseCurrency: string
    quoteCurrency: string
    sourceAmountMajor: number
    direction?: QuoteDirection
    amountPolicy?: AmountPolicy
    idempotencyKey?: string
    now?: Date
  }) {
    const baseCurrency = assertCurrency(input.baseCurrency)
    const quoteCurrency = assertCurrency(input.quoteCurrency)
    const pair = `${baseCurrency}/${quoteCurrency}`
    const direction = input.direction || "direct"
    const amountPolicy = input.amountPolicy || "exact-source"
    const now = input.now || new Date()

    if (!this.config.supportedPairs.includes(pair)) {
      throw new Error(`Unsupported FX pair ${pair}.`)
    }

    if (!Number.isFinite(input.sourceAmountMajor) || input.sourceAmountMajor <= 0) {
      throw new Error("Quote amount must be greater than zero.")
    }

    if (input.idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(input.idempotencyKey)
      if (existing) return existing
    }

    const providerQuote = await this.resolveProviderQuote(baseCurrency, quoteCurrency)
    const ageMs = nowMs(now) - nowMs(providerQuote.providerTimestamp)
    if (ageMs > this.config.maxQuoteAgeMs) {
      throw new Error("FX provider quote is stale.")
    }

    const rate = providerQuote.rate * (1 + this.config.markupBps / 10_000)
    if (!isValidRate(rate)) {
      throw new Error("FX provider returned an invalid rate.")
    }

    const amounts = convertMajorAmount({
      amountMajor: input.sourceAmountMajor,
      rate,
      sourceCurrency: baseCurrency,
      targetCurrency: quoteCurrency,
    })

    return this.repository.create({
      id: makeId(),
      version: 1,
      baseCurrency,
      quoteCurrency,
      direction,
      sourceAmountMajor: input.sourceAmountMajor,
      sourceAmountMinor: amounts.sourceAmountMinor,
      convertedAmountMajor: amounts.convertedAmountMajor,
      convertedAmountMinor: amounts.convertedAmountMinor,
      rate,
      providerRate: providerQuote.rate,
      provider: providerQuote.provider,
      providerTimestamp: providerQuote.providerTimestamp,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + this.config.quoteTtlMs),
      markupBps: this.config.markupBps,
      spreadBps: this.config.markupBps,
      amountPolicy,
      status: "created",
      idempotencyKey: input.idempotencyKey,
    })
  }

  async lockQuote(id: string, now = new Date()) {
    const quote = await this.requireQuote(id)
    this.assertUsable(quote, now)
    if (quote.status === "created") {
      return this.repository.update({ ...quote, status: "locked" })
    }
    return quote
  }

  async consumeQuote(input: {
    quoteId: string
    baseCurrency: string
    quoteCurrency: string
    sourceAmountMajor?: number
    sourceAmountMinor?: number
    direction?: QuoteDirection
    amountPolicy?: AmountPolicy
    consumedBy: string
    now?: Date
  }) {
    const quote = await this.requireQuote(input.quoteId)
    const now = input.now || new Date()
    this.assertUsable(quote, now)

    const baseCurrency = assertCurrency(input.baseCurrency)
    const quoteCurrency = assertCurrency(input.quoteCurrency)
    if (quote.baseCurrency !== baseCurrency || quote.quoteCurrency !== quoteCurrency) {
      throw new Error("Quote pair does not match the requested conversion.")
    }

    if ((input.direction || "direct") !== quote.direction) {
      throw new Error("Quote direction does not match the requested conversion.")
    }

    if ((input.amountPolicy || "exact-source") !== quote.amountPolicy) {
      throw new Error("Quote amount policy does not match the requested conversion.")
    }

    if (quote.status !== "locked") {
      if (quote.status === "consumed") throw new Error("Quote has already been consumed.")
      throw new Error("Quote must be locked before it can be consumed.")
    }

    const result = await this.repository.consume({
      quoteId: quote.id,
      expectedVersion: quote.version,
      baseCurrency,
      quoteCurrency,
      direction: input.direction || "direct",
      sourceAmountMajor: input.sourceAmountMajor,
      sourceAmountMinor: input.sourceAmountMinor,
      amountPolicy: input.amountPolicy || "exact-source",
      consumedBy: input.consumedBy,
      now,
    })

    if (result.ok) return result.quote
    throw new Error(this.consumeFailureMessage(result.reason))
  }

  private async resolveProviderQuote(baseCurrency: CurrencyCode, quoteCurrency: CurrencyCode) {
    let firstRate: number | null = null
    let lastError: Error | null = null

    for (const provider of this.providers) {
      try {
        const quote = await provider.getRate(baseCurrency, quoteCurrency)
        if (!isValidRate(quote.rate)) throw new Error("FX provider returned an invalid rate.")

        if (firstRate !== null && deviationBps(firstRate, quote.rate) > this.config.deviationThresholdBps) {
          throw new Error("FX fallback deviation threshold breached.")
        }

        return quote
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("FX provider failed.")
      }
    }

    throw lastError || new Error("No FX providers configured.")
  }

  private async requireQuote(id: string) {
    const quote = await this.repository.findById(id)
    if (!quote) throw new Error("Quote not found.")
    return quote
  }

  private assertUsable(quote: ExchangeRateQuoteSnapshot, now: Date) {
    if (quote.expiresAt.getTime() < now.getTime()) {
      throw new Error("Quote has expired.")
    }

    if (quote.status === "expired") {
      throw new Error("Quote has expired.")
    }
  }

  private consumeFailureMessage(reason: QuoteConsumeFailureReason) {
    switch (reason) {
      case "not-found":
        return "Quote not found."
      case "already-consumed":
        return "Quote has already been consumed."
      case "expired":
        return "Quote has expired."
      case "locked":
        return "Quote must be locked before it can be consumed."
      case "amount-mismatch":
        return "Quote source amount does not match the requested conversion."
      default:
        return "Quote consumption conflict."
    }
  }
}
