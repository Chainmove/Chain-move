# Exchange-Rate Integrity

All conversion logic must use `ExchangeRateQuoteService`. Clients may submit source amounts and currencies, but never rates. Balance-changing routes reject unexpected fields so raw client rates do not enter booked transactions.

Quote lifecycle:

- A quote snapshot records pair, direction, amount policy, provider rate, marked-up rate, provider timestamp, fetched time, expiry, provider name, version, and deterministic major/minor-unit conversion.
- A quote can be locked before work starts and consumed once during booking.
- Consumed quotes are immutable except for consumption metadata and are linked from transactions through `exchangeRateQuoteId` plus `bookedQuoteSnapshot`.
- Historical reports and reconciliation must use the booked snapshot. Current rates are only indicative.
- Unsupported, zero, negative, stale, or non-finite rates are rejected.

Operations:

- `npm run fx:legacy-check` inventories legacy transaction rows with `originalCurrency`, `exchangeRate`, or `amountOriginal`.
- Contributors can run offline with the static adapter and `FX_STATIC_RATES_JSON`.
- Provider fallback must not accept materially deviating rates beyond `FX_DEVIATION_BPS`.
