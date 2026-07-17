import ExchangeRateQuote from "@/models/ExchangeRateQuote"
import { ExchangeRateQuoteSnapshot } from "@/lib/fx/types"
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
    const document = await ExchangeRateQuote.findByIdAndUpdate(
      snapshot.id,
      {
        status: snapshot.status,
        consumedAt: snapshot.consumedAt,
        consumedBy: snapshot.consumedBy,
      },
      { new: true, runValidators: true },
    )

    if (!document) throw new Error("Quote not found.")
    return toSnapshot(document)
  }
}
