import { z } from "zod"

export const SUPPORTED_CURRENCIES = ["NGN", "USD", "EUR", "GBP"] as const
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

export const CurrencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(SUPPORTED_CURRENCIES))

export const MoneyMajorSchema = z.object({
  currency: CurrencyCodeSchema,
  amountMajor: z.number().finite().positive(),
})

export type MoneyMajor = z.infer<typeof MoneyMajorSchema>

export type QuoteDirection = "direct" | "inverse"
export type AmountPolicy = "exact-source" | "max-source"
export type QuoteStatus = "created" | "locked" | "consumed" | "expired"

export type ExchangeRateQuoteSnapshot = {
  id: string
  version: number
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  direction: QuoteDirection
  sourceAmountMajor: number
  sourceAmountMinor: number
  convertedAmountMajor: number
  convertedAmountMinor: number
  rate: number
  providerRate: number
  provider: string
  providerTimestamp: Date
  fetchedAt: Date
  expiresAt: Date
  markupBps: number
  spreadBps: number
  amountPolicy: AmountPolicy
  status: QuoteStatus
  idempotencyKey?: string
  consumedAt?: Date
  consumedBy?: string
}

export const MINOR_UNITS: Record<CurrencyCode, number> = {
  NGN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
}

export function assertCurrency(value: string): CurrencyCode {
  return CurrencyCodeSchema.parse(value)
}

export function isValidRate(rate: number) {
  return Number.isFinite(rate) && rate > 0
}

export function toMinorUnits(amountMajor: number, currency: CurrencyCode) {
  if (!Number.isFinite(amountMajor)) throw new Error("Money amount must be finite.")
  const multiplier = 10 ** MINOR_UNITS[currency]
  return Math.round((amountMajor + Number.EPSILON) * multiplier)
}

export function fromMinorUnits(amountMinor: number, currency: CurrencyCode) {
  const multiplier = 10 ** MINOR_UNITS[currency]
  return amountMinor / multiplier
}

export function convertMajorAmount({
  amountMajor,
  rate,
  sourceCurrency,
  targetCurrency,
}: {
  amountMajor: number
  rate: number
  sourceCurrency: CurrencyCode
  targetCurrency: CurrencyCode
}) {
  if (!isValidRate(rate)) throw new Error("Exchange rate must be positive and finite.")
  const convertedMajor = amountMajor * rate
  const convertedMinor = toMinorUnits(convertedMajor, targetCurrency)
  return {
    sourceAmountMinor: toMinorUnits(amountMajor, sourceCurrency),
    convertedAmountMinor: convertedMinor,
    convertedAmountMajor: fromMinorUnits(convertedMinor, targetCurrency),
  }
}
