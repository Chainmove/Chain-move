import { StaticExchangeRateAdapter, parseStaticRates } from "@/lib/fx/adapters"
import { MongooseQuoteRepository } from "@/lib/fx/mongoose-quote-repository"
import { ExchangeRateQuoteService } from "@/lib/fx/quote-service"
import { getServerConfig } from "@/lib/config/server"

export function createExchangeRateQuoteService() {
  const config = getServerConfig()
  return new ExchangeRateQuoteService(
    [new StaticExchangeRateAdapter(parseStaticRates(config.FX_STATIC_RATES_JSON), config.FX_PROVIDER)],
    new MongooseQuoteRepository(),
    {
      maxQuoteAgeMs: config.FX_MAX_QUOTE_AGE_SECONDS * 1000,
      quoteTtlMs: config.FX_QUOTE_TTL_SECONDS * 1000,
      deviationThresholdBps: config.FX_DEVIATION_BPS,
      markupBps: config.FX_MARKUP_BPS,
      supportedPairs: ["USD/NGN", "EUR/NGN", "GBP/NGN", "NGN/NGN"],
    },
  )
}
