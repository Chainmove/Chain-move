# Treasury controls

All treasury amounts are integer minor units (for NGN, kobo). Available liquidity is `available_cash - settlement_in_transit`; restricted escrow, fees, and suspense are never free cash. Required liquidity is `investor_payable + refund_payable + platform_reserve + minimum_reserve`.

Before a payout or refund is approved, reserve the amount in the authoritative transaction and evaluate the resulting liquidity. Hold it deterministically when the result is below required liquidity or a concentration limit is exceeded. Provider-pending settlements remain in transit until confirmed.

Daily snapshots store their source journal count and cutoff so a position can be reproduced. Adjustment proposals require an admin, reason, and append-only history; they do not mutate user balances. For a shortfall, pause affected disbursements, reconcile provider-pending settlements, record the incident and variance explanation, and release holds only after the reproduced position meets policy.
