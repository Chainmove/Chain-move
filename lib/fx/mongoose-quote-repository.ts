import ExchangeRateQuote from "@/models/ExchangeRateQuote"
import { ConsumeQuoteAtomicInput, ExchangeRateQuoteSnapshot, QuoteConsumeFailureReason } from "@/lib/fx/types"
import { QuoteRepository } from "@/lib/fx/quote-service"

function toSnapshot(document: any): ExchangeRateQuoteSnapshot {
  return {
    id: document._id.toString(),
    version: document.version,
    baseCurrency: document.baseCurrency,
    quoteCurrency: document.quoteCurrency,
    direction: document.direction,
    sourceAmountMajor: document.sourceAmountMajor,
    sourceAmountMinor: document.sourceAmountMinor,
    convertedAmountMajor: document.convertedAmountMajor,
    convertedAmountMinor: document.convertedAmountMinor,
    rate: document.rate,
    providerRate: document.providerRate,
    provider: document.provider,
    providerTimestamp: document.providerTimestamp,
    fetchedAt: document.fetchedAt,
    expiresAt: document.expiresAt,
    markupBps: document.markupBps,
    spreadBps: document.spreadBps,
    amountPolicy: document.amountPolicy,
    status: document.status,
    idempotencyKey: document.idempotencyKey,
    consumedAt: document.consumedAt,
    consumedBy: document.consumedBy,
  }
}

export class MongooseQuoteRepository implements QuoteRepository {
  async create(snapshot: ExchangeRateQuoteSnapshot) {
    const document = await ExchangeRateQuote.create({
      version: snapshot.version,
      baseCurrency: snapshot.baseCurrency,
      quoteCurrency: snapshot.quoteCurrency,
      direction: snapshot.direction,
      sourceAmountMajor: snapshot.sourceAmountMajor,
      sourceAmountMinor: snapshot.sourceAmountMinor,
      convertedAmountMajor: snapshot.convertedAmountMajor,
      convertedAmountMinor: snapshot.convertedAmountMinor,
      rate: snapshot.rate,
      providerRate: snapshot.providerRate,
      provider: snapshot.provider,
      providerTimestamp: snapshot.providerTimestamp,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      markupBps: snapshot.markupBps,
      spreadBps: snapshot.spreadBps,
      amountPolicy: snapshot.amountPolicy,
      status: snapshot.status,
      idempotencyKey: snapshot.idempotencyKey,
    })
    return toSnapshot(document)
  }

  async findById(id: string) {
    const document = await ExchangeRateQuote.findById(id)
    return document ? toSnapshot(document) : null
  }

  async findByIdempotencyKey(key: string) {
    const document = await ExchangeRateQuote.findOne({ idempotencyKey: key })
    return document ? toSnapshot(document) : null
  }

  async update(snapshot: ExchangeRateQuoteSnapshot) {
    if (snapshot.status === "consumed") {
      throw new Error("Use atomic consume to consume quotes.")
    }

    const document = await ExchangeRateQuote.findOneAndUpdate(
      {
        _id: snapshot.id,
        version: snapshot.version,
        status: { $ne: "consumed" },
      },
      {
        $set: {
          status: snapshot.status,
          consumedAt: snapshot.consumedAt,
          consumedBy: snapshot.consumedBy,
        },
        $inc: { version: 1 },
      },
      { new: true, runValidators: true },
    )

    if (!document) {
      const current = await ExchangeRateQuote.findById(snapshot.id)
      if (current) return toSnapshot(current)
      throw new Error("Quote not found.")
    }

    return toSnapshot(document)
  }

  async consume(input: ConsumeQuoteAtomicInput) {
    const amountFilter = this.consumeAmountFilter(input)

    const document = await ExchangeRateQuote.findOneAndUpdate(
      {
        _id: input.quoteId,
        version: input.expectedVersion,
        status: "locked",
        expiresAt: { $gte: input.now },
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        direction: input.direction,
        amountPolicy: input.amountPolicy,
        ...amountFilter,
      },
      {
        $set: {
          status: "consumed",
          consumedAt: input.now,
          consumedBy: input.consumedBy,
        },
        $inc: { version: 1 },
      },
      { new: true, runValidators: true },
    )

    if (document) return { ok: true as const, quote: toSnapshot(document) }

    const current = await this.findById(input.quoteId)
    return {
      ok: false as const,
      reason: this.resolveConsumeFailure(input, current),
      quote: current ?? undefined,
    }
  }

  private resolveConsumeFailure(
    input: ConsumeQuoteAtomicInput,
    quote: ExchangeRateQuoteSnapshot | null,
  ): QuoteConsumeFailureReason {
    if (!quote) return "not-found"
    if (quote.status === "consumed") return "already-consumed"
    if (quote.status === "expired" || quote.expiresAt.getTime() < input.now.getTime()) return "expired"
    if (quote.status !== "locked") return "conflict"
    if (quote.amountPolicy !== input.amountPolicy) return "conflict"

    const amountMatches = this.consumeAmountMatches(input, quote)

    if (!amountMatches) return "amount-mismatch"
    return "conflict"
  }

  private consumeAmountFilter(input: ConsumeQuoteAtomicInput) {
    if (input.sourceAmountMinor !== undefined) {
      return input.amountPolicy === "exact-source"
        ? { sourceAmountMinor: input.sourceAmountMinor }
        : { sourceAmountMinor: { $gte: input.sourceAmountMinor } }
    }

    return input.amountPolicy === "exact-source"
      ? { sourceAmountMajor: input.sourceAmountMajor }
      : { sourceAmountMajor: { $gte: input.sourceAmountMajor } }
  }

  private consumeAmountMatches(input: ConsumeQuoteAtomicInput, quote: ExchangeRateQuoteSnapshot) {
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
