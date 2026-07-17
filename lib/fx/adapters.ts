import { CurrencyCode, isValidRate } from "@/lib/fx/types"

export type ProviderQuote = {
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  rate: number
  provider: string
  providerTimestamp: Date
}

export interface ExchangeRateProviderAdapter {
  readonly name: string
  getRate(baseCurrency: CurrencyCode, quoteCurrency: CurrencyCode): Promise<ProviderQuote>
}

export class StaticExchangeRateAdapter implements ExchangeRateProviderAdapter {
  readonly name: string

  constructor(
    private readonly rates: Record<string, number>,
    name = "static",
  ) {
    this.name = name
  }

  async getRate(baseCurrency: CurrencyCode, quoteCurrency: CurrencyCode) {
    const directKey = `${baseCurrency}/${quoteCurrency}`
    const inverseKey = `${quoteCurrency}/${baseCurrency}`
    const directRate = this.rates[directKey]
    const inverseRate = this.rates[inverseKey]

    if (isValidRate(directRate)) {
      return {
        baseCurrency,
        quoteCurrency,
        rate: directRate,
        provider: this.name,
        providerTimestamp: new Date(),
      }
    }

    if (isValidRate(inverseRate)) {
      return {
        baseCurrency,
        quoteCurrency,
        rate: 1 / inverseRate,
        provider: this.name,
        providerTimestamp: new Date(),
      }
    }

    throw new Error(`Unsupported FX pair ${baseCurrency}/${quoteCurrency}.`)
  }
}

export class TimeoutExchangeRateAdapter implements ExchangeRateProviderAdapter {
  constructor(readonly name = "timeout") {}

  async getRate(): Promise<ProviderQuote> {
    throw new Error("FX provider timed out.")
  }
}

export function parseStaticRates(raw?: string) {
  if (!raw) {
    return {
      "USD/NGN": 1500,
      "EUR/NGN": 1650,
      "GBP/NGN": 1900,
      "NGN/NGN": 1,
    }
  }

  const parsed = JSON.parse(raw) as Record<string, number>
  for (const [pair, rate] of Object.entries(parsed)) {
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair) || !isValidRate(rate)) {
      throw new Error(`Invalid static FX rate for ${pair}.`)
    }
  }

  return parsed
}
